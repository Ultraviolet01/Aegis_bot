const b = Buffer.from('B+jcLN57I6DXQ/jxJ2tlfYqe6gaVC6Z6jTAzxTxM3k9zh7+/mQRd/kygJCPiMwcTP6iw7o5XTWEajmZSVUq5fRsUOgwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgcAAAAbAAAADwABAAA=', 'base64');

console.log("Length:", b.length);
console.log("Bytes 165..179 hex:", b.slice(165).toString('hex'));
// Extension type is u16 LE, length is u16 LE
const extType = b.readUInt16LE(165);
const extLen = b.readUInt16LE(167);
console.log("Extension type:", extType, "length:", extLen);
// ExtensionType 2 is ImmutableOwner!
// ExtensionType 7 is MemoTransfer!
// ExtensionType 27 is TokenMetadata or something?
// Let's print bytes
console.log("Tail bytes:", b.slice(169));
