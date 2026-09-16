import fs from 'fs';

const idl = JSON.parse(fs.readFileSync('target/idl/aegis.json', 'utf8'));
const types = idl.types || [];

function genType(t) {
  if (typeof t === 'string') {
    const mapping = {
      bool: 'bool',
      u8: 'u8',
      u16: 'u16',
      u32: 'u32',
      u64: 'u64',
      u128: 'u128',
      i64: 'i64',
      pubkey: 'Pubkey',
      string: 'String',
    };
    return mapping[t] || t;
  }
  if (typeof t === 'object') {
    if (t.defined) {
      return typeof t.defined === 'object' ? t.defined.name : t.defined;
    }
    if (t.vec) return `Vec<${genType(t.vec)}>`;
    if (t.option) return `Option<${genType(t.option)}>`;
  }
  return 'Unknown';
}

function toSnake(str) {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

let out = `// AUTO-GENERATED JUPITER CPI TYPES FOR AEGIS\n\nuse anchor_lang::prelude::*;\n\n`;

for (const t of types) {
  out += `#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]\n`;
  if (t.type.kind === 'enum') {
    out += `pub enum ${t.name} {\n`;
    for (const v of t.type.variants) {
      if (v.fields && v.fields.length > 0) {
        const flds = v.fields.map(f => `${toSnake(f.name)}: ${genType(f.type)}`).join(', ');
        out += `    ${v.name} { ${flds} },\n`;
      } else {
        out += `    ${v.name},\n`;
      }
    }
    out += `}\n\n`;
  } else if (t.type.kind === 'struct') {
    out += `pub struct ${t.name} {\n`;
    for (const f of t.type.fields) {
      out += `    pub ${toSnake(f.name)}: ${genType(f.type)},\n`;
    }
    out += `}\n\n`;
  }
}

fs.writeFileSync('scripts/generated_types.rs', out);
console.log('Successfully wrote scripts/generated_types.rs');
