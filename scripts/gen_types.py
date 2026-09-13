import json

idl = json.load(open('target/idl/aegis.json'))
types = {t['name']: t for t in idl.get('types', [])}

def gen_type(t):
    if isinstance(t, str):
        mapping = {'bool': 'bool', 'u8': 'u8', 'u16': 'u16', 'u32': 'u32', 'u64': 'u64', 'u128': 'u128', 'i64': 'i64', 'pubkey': 'Pubkey', 'string': 'String'}
        return mapping.get(t, t)
    if isinstance(t, dict):
        if 'defined' in t:
            d = t['defined']
            if isinstance(d, dict): d = d.get('name')
            return d
        if 'vec' in t: return f"Vec<{gen_type(t['vec'])}>"
        if 'option' in t: return f"Option<{gen_type(t['option'])}>"
    return 'Unknown'

for tname, t in types.items():
    print('#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]')
    if t['type']['kind'] == 'enum':
        print(f"pub enum {tname} {{")
        for v in t['type']['variants']:
            if 'fields' in v:
                flds = ', '.join([f"{f['name']}: {gen_type(f['type'])}" for f in v['fields']])
                print(f"    {v['name']} {{ {flds} }},")
            else:
                print(f"    {v['name']},")
        print('}\n')
    elif t['type']['kind'] == 'struct':
        print(f"pub struct {tname} {{")
        for f in t['type']['fields']:
            name = f['name']
            # camelCase to snake_case
            snake = ''
            for c in name:
                if c.isupper():
                    snake += '_' + c.lower()
                else:
                    snake += c
            print(f"    pub {snake}: {gen_type(f['type'])},")
        print('}\n')
