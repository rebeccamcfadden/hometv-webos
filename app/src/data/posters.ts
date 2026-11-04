// TEMPORARY copy of hometv-launcher's design_preview/src/data/posters.ts at 2bf3c2d, until the catalogue moves into
// @hometv/core. Mock data for the PC and the emulator. Changes: the types import; no local landscape art (3 MB of
// JPEGs) as the fallback, so a poster that's missing or can't load gets `is-missing` and the screen shows the title.
import type { Title } from '@hometv/core/types.ts';

// F40: each title's poster on TMDB (its poster_path, looked up by name and year on 2026-11-02), for the portrait gallery
// cards still being chosen between. TMDB serves it (image.tmdb.org, as the launcher's TMDB art).
const POSTERS: Record<string, string> = {
  '911': '/u6HuWWohheyzAj5PUn4rBd0eH92.jpg',
  'arrival': '/pEzNVQfdzYDzVK0XqxERIw2x2se.jpg',
  'dune': '/6izwz7rsy95ARzTR3poZ8H6c5pp.jpg',
  'past-lives': '/k3waqVXSnvCZWfJYNtdamTgTtTA.jpg',
  'mitchells': '/mI2Di7HmskQQ34kz0iau6J1vr70.jpg',
  'coda': '/BzVjmm8l23rPsijLiNLUzuQtyd.jpg',
  'moon': '/35IU0Mq0zFsN1mYwDGts5mKc77n.jpg',
  'knives-out': '/pThyQovXQrw2m0s9x82twj48Jq4.jpg',
  'budapest': '/eWdyYQreja6JGCzqHWXpWHDrrPo.jpg',
  'eeaao': '/u68AjlvlutfEIcpmbYpKcdi09ut.jpg',
  'oppenheimer': '/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg',
  'killers': '/dB6Krk806zeqd0YNp2ngQ9zXteH.jpg',
  'poor-things': '/kCGlIMHnOm8JPXq3rXM6c5wMxcT.jpg',
  'maestro': '/kxj7rMco6RNYsVcNwuGAIlfWu64.jpg',
  'zone': '/hUu9zyZmDd8VZegKi1iK1Vk0RYS.jpg',
  'anatomy': '/1ho0d4LNZw3Y0voeKmSvPSgJOJ2.jpg',
  'american-fiction': '/57MFWGHarg9jid7yfDTka4RmcMU.jpg',
  'severance': '/pPHpeI2X1qEd1CS1SeyrdhZ4qnT.jpg',
  'the-bear': '/eKfVzzEazSIjJMrw9ADa2x8ksLz.jpg',
  'dark': '/wiiyc3m6HKaQhFBYeuM7ySCNQsG.jpg',
  'last-of-us': '/dmo6TYuuJgaYinXBPjrgG9mB5od.jpg',
  'shogun': '/7O4iVfOMQmdCSxhOg1WnzG1AgYT.jpg',
  'fallout': '/c15BtJxCXMrISLVmysdsnZUPQft.jpg',
  'our-planet': '/wRSnArnQBmeUYb5GWDU595bGsBr.jpg',
  'microcosmos': '/wEXqnKaHOuFnPDKbDlkKcPhd3jU.jpg',
  'peripheral': '/2e5NNQu9B1fXBNllRj8fzysCguP.jpg',
  'the-crown': '/1M876KPjulVwppEpldhdc8V4o68.jpg',
  'wheel-of-time': '/ihBi24EIr5kwAeY2PqmsgAcCj4n.jpg',
  'blue-planet': '/j1NsoYYDYHnPkRr7Enqr8tlexgO.jpg',
  'carnival-row': '/jyhxT10e2z9IDsKoIQDKhyxSQJt.jpg',
  'the-arrival-1996': '/4H3VwvIQC1dsMFb2DEGZpbS0JiI.jpg',
  'blade-runner-2049': '/gajva2L0rPYkEWjzgFlBXCAVBE5.jpg',
  'interstellar': '/yQvGrMoipbRoddT0ZR8tPoR7NfX.jpg',
  'larva-island': '/vlNvnatIn9js6yhwW8DLDSoLEY3.jpg',
  'carnival-of-souls': '/AdbQsFB8pS090l0NO3uBtLZy2zw.jpg',
  'mrs-maisel': '/zS7fQiOZiKCVH2vlYSiIsFWW8hh.jpg',
  'marvel-assembled': '/v2BHRwtQVkt5fssLdo5MpFgHJPY.jpg',
  'daredevil': '/QWbPaDxiB6LW2LjASknzYBvjMj.jpg',
  'harvey-girls': '/qGta8SzLwRTFsmsWtlS8d7pFKt6.jpg',
  'carnival-eats': '/gk2HiUJOSXOrzeiVBS9LpBbLqkw.jpg',
  'carnivale': '/5pKvfZ3qLuKJd8PQfKcPxN9jTO9.jpg',
  '911-lone-star': '/BOTITv548LYGB4xRD3rHfbwkqm.jpg',
};

/** TMDB's image size for a poster about 270 px wide on the 1920 px stage. */
const SIZE = 'w342';

export const posterUrl = (t: Title): string | null => (POSTERS[t.id] ? `https://image.tmdb.org/t/p/${SIZE}${POSTERS[t.id]}` : null);

/** The poster as an <img>; with none, or when it won't load, the <img> gets is-missing and the screen shows the title. */
export function posterImg(t: Title): HTMLImageElement {
  const img = document.createElement('img');
  img.alt = '';
  img.decoding = 'async';
  const url = posterUrl(t);
  const crop = () => {
    img.onerror = null;
    img.classList.add('is-missing');
  };
  if (!url) crop();
  else {
    img.onerror = crop;
    img.src = url;
  }
  return img;
}
