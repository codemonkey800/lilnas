/*
 * The mockups' entire runtime. Inlined into every page by build.mjs.
 *
 * Keep it this small. Anything a mockup needs to *demonstrate* — the
 * desktop/mobile switch, tab selection, a "filters open" state — is done in
 * CSS with :has() and hidden radios instead, because these files get opened
 * through wrappers (iframe srcdoc among them) where a page's own <script>
 * never runs. A mockup must still read correctly with JS off.
 */
;(function () {
  'use strict'

  /*
   * Poster art lives in assets/emby and assets/video, which are gitignored —
   * they're studio-owned key art (see assets/README.md). On a fresh clone, or
   * before ./fetch-assets.sh has been run, those files are 404s. Drop the
   * broken <img> so the CSS gradient placeholder behind it shows through.
   *
   * Both paths matter: images that fail after this script runs fire `error`,
   * and images that already failed while the HTML was parsing never will —
   * those are the ones `complete && !naturalWidth` catches.
   */
  function dropIfBroken(img) {
    if (img.complete) {
      if (!img.naturalWidth) img.remove()
      return
    }
    img.addEventListener('error', function () {
      img.remove()
    })
  }

  var images = document.querySelectorAll('img[data-poster]')
  for (var i = 0; i < images.length; i++) dropIfBroken(images[i])
})()
