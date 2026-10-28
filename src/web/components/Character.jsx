const colors = { cyan: '#88C0D0', violet: '#B48EAD', blue: '#5E81AC', amber: '#EBCB8B', lime: '#A3BE8C', pink: '#BF616A' };
const facePath = 'M23 23h-8v14h8M49 23h-8v14h8M28 41h8';
function faceImage(color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="2" y="2" width="60" height="60" rx="20" fill="#2E3440" stroke="${color}" stroke-width="3"/><path d="${facePath}" fill="none" stroke="${color}" stroke-width="3"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
export default function Character({ profile, brand = false, welcome = false }) {
  const color = colors[profile?.color] || colors.cyan;
  return <span class={`relative block flex-none ${welcome ? 'mx-auto mb-[22px] h-[72px] w-[72px]' : brand ? 'h-7 w-7' : 'h-9 w-9'}`} aria-hidden={welcome ? undefined : 'true'} role={welcome ? 'img' : undefined} aria-label={welcome ? 'Sunday, a square character' : undefined}>
    <span class="absolute inset-0 grid place-items-center rounded-[20px] border-[3px] bg-base-100 font-mono text-[0px]" aria-hidden="true" style={{ backgroundImage: faceImage(color), backgroundPosition: 'center', backgroundSize: 'contain', backgroundRepeat: 'no-repeat' }}>c_c</span>
  </span>;
}
