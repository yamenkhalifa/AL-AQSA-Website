"""Check actual pages, translations, local links and deployment coverage."""
from pathlib import Path
from html.parser import HTMLParser
import json,re
R=Path(__file__).resolve().parents[1]
class Page(HTMLParser):
 def __init__(self):
  super().__init__();self.links=[];self.keys=[];self.h1=0;self.ids=[]
 def handle_starttag(self,tag,attrs):
  attrs=dict(attrs)
  if tag=='h1': self.h1+=1
  if 'id' in attrs:self.ids.append(attrs['id'])
  for key in ['href','src']:
   if key in attrs:self.links.append(attrs[key])
  for key,value in attrs.items():
   if key.startswith('data-i18n'):self.keys.append(value)
base=json.loads((R/'assets/locales/en.json').read_text(encoding='utf-8'))
pages=list(R.glob('*.html'))
script=(R/'scripts/deploy-ftps.sh').read_text()
for f in pages:
 parser=Page();parser.feed(f.read_text(encoding='utf-8'))
 assert parser.h1==1,(f.name,'heading count')
 assert len(parser.ids)==len(set(parser.ids)),(f.name,'duplicate IDs')
 assert f.name in script,(f.name,'deployment coverage')
 for key in parser.keys: assert key in base,(f.name,key)
 for link in parser.links:
  if link.startswith(('http:','https:','mailto:','tel:','data:','#')):continue
  target=link.split('#')[0].split('?')[0]
  assert (R/target).is_file(),(f.name,link)
for item in json.loads((R/'assets/locales/registry.json').read_text(encoding='utf-8')):
 data=json.loads((R/f'assets/locales/{item["code"]}.json').read_text(encoding='utf-8'))
 assert all(k in data and data[k].strip() for k in base),item['code']
print(f'PASS: {len(pages)} pages, local links, deployment allowlist, and 40 language dictionaries')
