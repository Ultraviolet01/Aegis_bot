async function check() {
  // Common devnet mints: Devnet SOL/WSOL: So11111111111111111111111111111111111111112
  // Devnet USDC: Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr (or similar)
  try {
    const res = await fetch('https://api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr&amount=100000000');
    console.log('Jupiter response status:', res.status);
    const data = await res.json();
    console.log('Data:', data);
  } catch (e) {
    console.error(e);
  }
}
check();
