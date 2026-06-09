// Scramble-erase animation: characters cycle through glyphs then disappear left-to-right
const GLYPHS = 'アイウエオカキクケコ01ABCDEF!@#$%█▓▒░ωδφψ∑∆◆◇';

export function scrambleOut(el, duration = 600) {
  return new Promise(resolve => {
    const original = el.innerText;
    const start = performance.now();

    const tick = (now) => {
      const p = Math.min((now - start) / duration, 1);

      el.innerHTML = [...original].map((char, i, arr) => {
        if (char === '\n') return '<br>';
        if (char === ' ')  return '&nbsp;';

        // Each character has a staggered erase window: left chars go first
        const charDelay  = (i / arr.length) * 0.55;
        const localP     = Math.max(0, Math.min((p - charDelay) / (1 - charDelay), 1));

        if (localP <= 0)  return `<span>${char}</span>`;
        if (localP >= 1)  return `<span style="opacity:0;display:inline-block;min-width:0.1ch">&nbsp;</span>`;

        const glyph   = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        const opacity = (1 - localP).toFixed(3);
        return `<span style="color:#8EBCF0;opacity:${opacity}">${glyph}</span>`;
      }).join('');

      if (p < 1) requestAnimationFrame(tick);
      else        resolve();
    };

    requestAnimationFrame(tick);
  });
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
