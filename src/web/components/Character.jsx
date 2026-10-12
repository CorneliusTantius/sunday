import { useState } from 'preact/hooks';

const colors = { cyan: '#00E5FF', violet: '#9D5CFF', blue: '#3874FF', amber: '#FFB020', lime: '#B7F52A', pink: '#FF3D9A' };
const paths = { normal: 'M23 23h-8v14h8M49 23h-8v14h8M28 41h8', sweat: 'M23 23h-8v14h8M47 23h-8v14h8M28 41h8M53 17v6', sideeye: 'M15 25h10v8M39 25h10v8M28 41h8', blink: 'M15 30h8M41 30h8M28 41h8' };
function faceImage(color, expression) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="2" y="2" width="60" height="60" rx="20" fill="#090B10" stroke="${color}" stroke-width="3"/><path d="${paths[expression]}" fill="none" stroke="${color}" stroke-width="3"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
export default function Character({ profile, brand = false, welcome = false }) {
  const [face, setFace] = useState('normal');
  const color = colors[profile?.color] || colors.cyan;
  return <span class={`square-character${welcome ? '' : brand ? ' brand-character' : ' avatar-character'}`} data-face={face} data-color={profile ? color : undefined} aria-hidden={welcome ? undefined : 'true'} role={welcome ? 'img' : undefined} aria-label={welcome ? 'Sunday, a blinking square character' : undefined}>
    <span class="character-face character-awake" aria-hidden="true" style={profile ? { backgroundImage: faceImage(color, face) } : undefined} onAnimationIteration={() => { const choices = ['normal', 'sweat', 'sideeye'].filter(item => item !== face); setFace(choices[Math.floor(Math.random() * choices.length)]); }}>c_c</span>
    <span class="character-face character-blink" aria-hidden="true" style={profile ? { backgroundImage: faceImage(color, 'blink') } : undefined}>-_-</span>
  </span>;
}
