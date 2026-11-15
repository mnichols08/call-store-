// The Southern Auto Supply artwork behind the cards, faded in under a theme overlay. One picture per
// browser session so pages don't flicker between pictures as you move around.
(() => {
  const PICTURES = ['1g-eclipse', 'crownvic-southern', 'eclipse-challenge-southern', 'vw-southern', 'vw-atlas-southern', 'ram-2500-southern'];
  let pick;
  try {
    pick = sessionStorage.getItem('cs-bg');
    if (!PICTURES.includes(pick)) {
      pick = PICTURES[Math.floor(Math.random() * PICTURES.length)];
      sessionStorage.setItem('cs-bg', pick);
    }
  } catch {
    pick ??= PICTURES[0];
  }
  const layer = document.getElementById('bg-layer');
  if (!layer) return;
  const url = `/assets/bg-${pick}-bg.webp`;
  const image = new Image();
  image.onload = () => {
    layer.style.backgroundImage = `url("${url}")`;
    requestAnimationFrame(() => layer.classList.add('show'));
  };
  image.src = url;
})();
