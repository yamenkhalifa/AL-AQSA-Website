<?php
declare(strict_types=1);

// Run on the PHP-enabled host. SMTP credentials stay in a private file outside httpdocs.
const ENQUIRY_MAILBOX = 'info@al-aqsa.eu';
const ENQUIRY_SUCCESS = 'Thank you — your enquiry has been submitted. We’ll be in touch.';
const ENQUIRY_UNAVAILABLE = 'We couldn’t send your enquiry right now. Please try again later, or email info@al-aqsa.eu.';

ini_set('display_errors', '0');
header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store, private');
header('X-Content-Type-Options: nosniff');

function respond(int $status, bool $ok, string $message, array $extra = []): void
{
    // Registry lookup is an allowlist; untrusted language values never become file paths.
    $requestedLanguage = ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST'
        ? ($_POST['lang'] ?? 'en') : ($_GET['lang'] ?? 'en');
    $translations = [
        'Thank you — your enquiry has been submitted. We’ll be in touch.' => ['server.success', 'شكرًا لك — تم إرسال استفسارك. سنتواصل معك قريبًا.'],
        'We couldn’t send your enquiry right now. Please try again later, or email info@al-aqsa.eu.' => ['server.unavailable', 'تعذر إرسال استفسارك الآن. يرجى المحاولة لاحقًا، أو مراسلتنا على info@al-aqsa.eu.'],
        'Please check the form and complete all required fields.' => ['server.required', 'يرجى مراجعة النموذج وإكمال جميع الحقول المطلوبة.'],
        'This request method is not supported.' => ['server.method', 'طريقة الطلب هذه غير مدعومة.'],
        'Please send your enquiry from the AL-AQSA website.' => ['server.origin', 'يرجى إرسال استفسارك من موقع AL-AQSA.'],
        'Your enquiry is too long. Please shorten it and try again.' => ['server.too_long', 'استفسارك طويل جدًا. يرجى اختصاره والمحاولة مرة أخرى.'],
        'Please submit your enquiry using the website form.' => ['server.content_type', 'يرجى إرسال استفسارك باستخدام نموذج الموقع.'],
        'Ready to send your enquiry.' => ['server.ready', 'النموذج جاهز لإرسال استفسارك.'],
        'Your form session expired. Please allow cookies for this site and try again.' => ['server.session', 'انتهت صلاحية جلسة النموذج. يرجى السماح بملفات تعريف الارتباط لهذا الموقع والمحاولة مرة أخرى.'],
        'Please check the form and try again.' => ['server.invalid', 'يرجى مراجعة النموذج والمحاولة مرة أخرى.'],
        'Please enter your name (up to 160 characters).' => ['server.name', 'يرجى إدخال اسمك (بحد أقصى 160 حرفًا).'],
        'Please enter a valid email address.' => ['server.email', 'يرجى إدخال بريد إلكتروني صحيح.'],
        'Please select a service from the list.' => ['server.service', 'يرجى اختيار خدمة من القائمة.'],
        'Please describe your project in 1 to 5,000 characters.' => ['server.message', 'يرجى وصف مشروعك بنص يتراوح بين حرف واحد و5,000 حرف.'],
        'Please refresh the page and try again.' => ['server.refresh', 'يرجى تحديث الصفحة والمحاولة مرة أخرى.'],
        'This enquiry was already submitted. Refresh the page before sending another.' => ['server.duplicate', 'سبق إرسال هذا الاستفسار. يرجى تحديث الصفحة قبل إرسال استفسار آخر.'],
        'The form has received too many enquiries. Please try again later, or email info@al-aqsa.eu.' => ['server.rate_limit', 'تلقى النموذج عددًا كبيرًا من الاستفسارات. يرجى المحاولة لاحقًا، أو مراسلتنا على info@al-aqsa.eu.'],
    ];
    if (isset($translations[$message])) {
        [$key, $arabic] = $translations[$message];
        $extra['message_key'] = $key;
        if ($requestedLanguage === 'ar') $message = $arabic;
        if (is_string($requestedLanguage) && $requestedLanguage !== 'en' && $requestedLanguage !== 'ar') {
            $registry = json_decode((string) @file_get_contents(__DIR__ . '/assets/locales/registry.json'), true);
            $allowed = is_array($registry) ? array_column($registry, 'code') : [];
            if (in_array($requestedLanguage, $allowed, true)) {
                $locale = json_decode((string) @file_get_contents(__DIR__ . '/assets/locales/' . $requestedLanguage . '.json'), true);
                if (is_array($locale) && isset($locale[$key]) && is_string($locale[$key])) $message = $locale[$key];
            }
        }
    }
    http_response_code($status);
    echo json_encode(array_merge(['ok' => $ok, 'message' => $message], $extra), JSON_UNESCAPED_UNICODE);
    exit;
}

function field(string $key): string
{
    if (!isset($_POST[$key]) || !is_string($_POST[$key])) {
        respond(422, false, 'Please check the form and complete all required fields.');
    }
    return trim($_POST[$key]);
}

// One locked file keeps limits effective across new sessions and concurrent requests.
// It stores only a random salt, hashed IP addresses, counters and timestamps.
function reserveSend(): int
{
    $directory = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR)
        . '/alaqsa-enquiries-' . substr(hash('sha256', __DIR__), 0, 16);
    if (!is_dir($directory) && !@mkdir($directory, 0700) && !is_dir($directory)) {
        throw new RuntimeException('Cannot prepare rate-limit storage');
    }
    $path = $directory . '/limits.json';
    $handle = @fopen($path, 'c+');
    if ($handle === false) {
        throw new RuntimeException('Cannot open rate-limit storage');
    }
    @chmod($path, 0600);
    try {
        if (!flock($handle, LOCK_EX)) {
            throw new RuntimeException('Cannot lock rate-limit storage');
        }
        $raw = stream_get_contents($handle);
        if ($raw === false) {
            throw new RuntimeException('Cannot read rate-limit storage');
        }
        $state = $raw === '' ? ['salt' => bin2hex(random_bytes(32)), 'attempts' => []]
            : json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        if (!is_array($state) || !isset($state['salt'], $state['attempts'])
            || !is_string($state['salt']) || !is_array($state['attempts'])) {
            throw new RuntimeException('Invalid rate-limit storage');
        }
        $now = time();
        $attempts = array_values(array_filter($state['attempts'], static function ($attempt) use ($now) {
            return is_array($attempt) && isset($attempt['at'], $attempt['ip'])
                && is_int($attempt['at']) && $attempt['at'] > $now - 3600;
        }));
        // Use the server's remote address, never an untrusted forwarded-IP header.
        $address = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
        $ipHash = hash_hmac('sha256', $address, $state['salt']);
        $own = array_values(array_filter($attempts, static function ($attempt) use ($ipHash) {
            return $attempt['ip'] === $ipHash;
        }));
        $retryAfter = 0;
        if (count($own) >= 5) {
            $retryAfter = max(1, $own[0]['at'] + 3600 - $now);
        }
        if (count($attempts) >= 30) {
            $retryAfter = max($retryAfter, $attempts[0]['at'] + 3600 - $now, 1);
        }
        if ($retryAfter === 0) {
            $attempts[] = ['at' => $now, 'ip' => $ipHash];
        }
        $state['attempts'] = $attempts;
        $encoded = json_encode($state, JSON_THROW_ON_ERROR);
        if (!rewind($handle) || !ftruncate($handle, 0)
            || fwrite($handle, $encoded) !== strlen($encoded) || !fflush($handle)) {
            throw new RuntimeException('Cannot save rate-limit storage');
        }
        return $retryAfter;
    } finally {
        flock($handle, LOCK_UN);
        fclose($handle);
    }
}


function sendAuthenticatedEnquiry(string $configPath, string $replyTo, string $project, string $body): void
{
    $raw = @file_get_contents($configPath);
    if ($raw === false) {
        throw new RuntimeException('Cannot read private mail configuration');
    }
    $config = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($config) || ($config['username'] ?? '') !== ENQUIRY_MAILBOX
        || !is_string($config['password'] ?? null) || $config['password'] === ''
        || !is_string($config['host'] ?? null) || $config['host'] === ''
        || !is_int($config['port'] ?? null) || $config['port'] < 1 || $config['port'] > 65535) {
        throw new RuntimeException('Invalid private mail configuration');
    }
    $directory = dirname($configPath);
    require_once $directory . '/Exception.php';
    require_once $directory . '/SMTP.php';
    require_once $directory . '/PHPMailer.php';

    $mailer = new \PHPMailer\PHPMailer\PHPMailer(true);
    $mailer->isSMTP();
    $mailer->Host = $config['host'];
    $mailer->Port = $config['port'];
    $mailer->SMTPAuth = true;
    $mailer->AuthType = 'LOGIN';
    $mailer->Username = ENQUIRY_MAILBOX;
    $mailer->Password = $config['password'];
    $mailer->SMTPSecure = \PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_STARTTLS;
    $mailer->SMTPOptions = ['ssl' => [
        'verify_peer' => true,
        'verify_peer_name' => true,
        'allow_self_signed' => false,
    ]];
    $mailer->SMTPDebug = 0;
    $mailer->Timeout = 10;
    $mailer->getSMTPInstance()->Timelimit = 15;
    $mailer->CharSet = \PHPMailer\PHPMailer\PHPMailer::CHARSET_UTF8;
    $mailer->Encoding = \PHPMailer\PHPMailer\PHPMailer::ENCODING_BASE64;
    $mailer->setFrom(ENQUIRY_MAILBOX, 'AL-AQSA website');
    $mailer->addAddress(ENQUIRY_MAILBOX);
    $mailer->addReplyTo($replyTo);
    $mailer->Subject = 'AL-AQSA enquiry: ' . $project;
    $mailer->Body = $body;
    $mailer->send();
}

$failureCode = 'server_error';
try {
    $method = $_SERVER['REQUEST_METHOD'] ?? '';
    if (!in_array($method, ['GET', 'POST'], true)) {
        header('Allow: GET, POST');
        respond(405, false, 'This request method is not supported.');
    }
    if (($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') {
        respond(403, false, 'Please send your enquiry from the AL-AQSA website.');
    }
    // Match the request authority; the session token also protects requests without Origin.
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '') {
        $parts = parse_url($origin);
        $authority = is_array($parts) && isset($parts['host']) ? strtolower($parts['host']) : '';
        if (is_array($parts) && isset($parts['port'])) {
            $authority .= ':' . $parts['port'];
        }
        if ($authority === '' || $authority !== strtolower($_SERVER['HTTP_HOST'] ?? '')
            || !in_array($parts['scheme'] ?? '', ['http', 'https'], true)) {
            respond(403, false, 'Please send your enquiry from the AL-AQSA website.');
        }
    }
    if ($method === 'POST' && (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 32768) {
        respond(413, false, 'Your enquiry is too long. Please shorten it and try again.');
    }
    if ($method === 'POST') {
        $type = strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0]));
        if (!in_array($type, ['multipart/form-data', 'application/x-www-form-urlencoded'], true)) {
            respond(415, false, 'Please submit your enquiry using the website form.');
        }
    }

    $failureCode = 'session_unavailable';
    session_name('alaqsa_enquiry');
    $secure = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
    if (!session_start([
        'use_strict_mode' => 1,
        'use_only_cookies' => 1,
        'cookie_httponly' => true,
        'cookie_secure' => $secure,
        'cookie_samesite' => 'Strict',
        'cookie_lifetime' => 0,
        'cookie_path' => '/',
    ])) {
        throw new RuntimeException('Cannot start secure form session');
    }
    // A session lock stays held until mail() returns, making simultaneous retries safe.
    if ($method === 'GET') {
        if (!isset($_SESSION['token'], $_SESSION['token_at']) || $_SESSION['token_at'] < time() - 3600) {
            $_SESSION['token'] = bin2hex(random_bytes(32));
            $_SESSION['token_at'] = time();
        }
        respond(200, true, 'Ready to send your enquiry.', ['token' => $_SESSION['token']]);
    }
    $failureCode = 'server_error';
    $token = field('token');
    if (!isset($_SESSION['token'], $_SESSION['token_at']) || $_SESSION['token_at'] < time() - 3600
        || !hash_equals($_SESSION['token'], $token)) {
        respond(403, false, 'Your form session expired. Please allow cookies for this site and try again.');
    }
    if (field('website') !== '' || !empty($_FILES)) {
        respond(422, false, 'Please check the form and try again.');
    }

    $name = field('name');
    $email = field('email');
    $project = field('project');
    $message = field('message');
    $requestId = field('request_id');
    $services = [
        'Mendix consulting', 'Web application or PWA', 'Website design & development',
        'Training or workshop', 'Something else',
    ];
    if (strlen($name) > 640 || !preg_match('/\A[^\x00-\x1F\x7F]{1,160}\z/u', $name)) {
        respond(422, false, 'Please enter your name (up to 160 characters).');
    }
    if (strlen($email) > 254 || preg_match('/[\r\n\x00]/', $email)
        || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        respond(422, false, 'Please enter a valid email address.');
    }
    if (!in_array($project, $services, true)) {
        respond(422, false, 'Please select a service from the list.');
    }
    if (strlen($message) > 20000 || !preg_match('/\A.{1,5000}\z/us', $message)
        || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $message)) {
        respond(422, false, 'Please describe your project in 1 to 5,000 characters.');
    }
    if (!preg_match('/\A[a-f0-9]{32}\z/', $requestId)) {
        respond(422, false, 'Please refresh the page and try again.');
    }

    $digest = hash('sha256', json_encode([$name, $email, $project, $message], JSON_THROW_ON_ERROR));
    $sent = $_SESSION['sent'] ?? [];
    $sent = array_filter($sent, static function ($item) { return $item['at'] > time() - 3600; });
    $_SESSION['sent'] = $sent;
    if (isset($sent[$requestId])) {
        if (!hash_equals($sent[$requestId]['digest'], $digest)) {
            respond(409, false, 'This enquiry was already submitted. Refresh the page before sending another.');
        }
        respond(200, true, ENQUIRY_SUCCESS);
    }
    $failureCode = 'storage_unavailable';
    $retryAfter = reserveSend();
    if ($retryAfter > 0) {
        header('Retry-After: ' . $retryAfter);
        respond(429, false, 'The form has received too many enquiries. Please try again later, or email info@al-aqsa.eu.');
    }
    $failureCode = 'server_error';

    $body = implode("\r\n", [
        'New enquiry from the AL-AQSA website', '',
        'Name: ' . $name, 'Email: ' . $email, 'Service: ' . $project, '',
        'Project details:', preg_replace('/\r\n|\r|\n/', "\r\n", $message), '',
        'Use Reply to respond directly to this visitor.',
    ]);
    $headers = [
        'From' => 'AL-AQSA website <' . ENQUIRY_MAILBOX . '>',
        'Reply-To' => $email,
        'MIME-Version' => '1.0',
        'Content-Type' => 'text/plain; charset=UTF-8',
        'Content-Transfer-Encoding' => 'base64',
    ];
    // All destination, sender and envelope addresses are fixed, never supplied by visitors.
    $configPath = dirname(__DIR__) . '/private/alaqsa-enquiry/mail.json';
    if (is_file($configPath)) {
        $failureCode = 'smtp_rejected';
        sendAuthenticatedEnquiry($configPath, $email, $project, $body);
    } else {
        $failureCode = 'mail_unavailable';
        if (!function_exists('mail')) {
            throw new RuntimeException('Mail transport is unavailable');
        }
        $failureCode = 'mail_rejected';
        $accepted = @mail(ENQUIRY_MAILBOX, 'AL-AQSA enquiry: ' . $project,
            chunk_split(base64_encode($body), 76, "\r\n"), $headers, '-f' . ENQUIRY_MAILBOX);
        if (!$accepted) {
            throw new RuntimeException('Mail transport rejected the enquiry');
        }
    }
    $_SESSION['sent'][$requestId] = ['digest' => $digest, 'at' => time()];
    respond(200, true, ENQUIRY_SUCCESS);
} catch (Throwable $error) {
    // Never log the submitted content, email address or session token.
    error_log('AL-AQSA enquiry: ' . $failureCode . ' (' . get_class($error) . ').');
    respond(503, false, ENQUIRY_UNAVAILABLE, ['error_code' => $failureCode]);
}
