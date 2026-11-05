// TEMPORARY copy of hometv-launcher's design_preview/src/data/catalog.ts at 2bf3c2d, until the catalogue moves into
// @hometv/core. Mock data for the PC and the emulator. Changes: the types import, and flatMap (Chromium 69) written
// for Chromium 56.
// Illustrative data only: availability, prices and scores are made up for the prototype.
import type { Episode, ListId, Offer, Person, Quality, Season, ServiceId, Title } from '@hometv/core/types.ts';

const sub = (service: ServiceId, quality = '4K · HDR'): Offer => ({ service, type: 'sub', quality });
const free = (service: ServiceId, quality = 'HD'): Offer => ({ service, type: 'free', quality });
type Prices = Partial<Record<Quality, number>>;
/** A rental in kronor per quality; no prices for a store no price source priced. */
const rent = (service: ServiceId, prices?: Prices, seasonal?: boolean): Offer => ({ service, type: 'rent', prices, seasonal });
const buy = (service: ServiceId, prices?: Prices, seasonal?: boolean): Offer => ({ service, type: 'buy', prices, seasonal });

/**
 * Rent and buy offers in four Swedish stores, in kronor, from Apple's HD prices `r` and `b`: the Apple TV Store with
 * dearer 4K, Amazon Video with 4K to buy only, SF Anytime in HD and cheapest, and the Viaplay Store in HD.
 */
const stores = (r = 49, b = 149): Offer[] => [
  rent('appletv', { HD: r, '4K': r + 10 }),
  buy('appletv', { HD: b, '4K': b + 30 }),
  rent('viaplaystore', { HD: r }),
  buy('viaplaystore', { HD: b }),
  rent('sfanytime', { HD: r - 10 }),
  buy('sfanytime', { HD: b - 20 }),
  rent('amazonvideo', { HD: r - 4 }),
  buy('amazonvideo', { HD: b - 10, '4K': b + 20 }),
];

/** A store that rents and sells the title but that no price source prices: it reads "Rent · Buy". */
const unpriced = (service: ServiceId): Offer[] => [rent(service), buy(service)];

const p = (name: string, role: string): Person => ({ name, role });

function seasons(spec: (number | string[])[], runtime: number): Season[] {
  return spec.map((s, i) => {
    const names = typeof s === 'number' ? Array.from({ length: s }, (_, k) => `Episode ${k + 1}`) : s;
    const episodes: Episode[] = names.map((name, k) => ({ n: k + 1, name, runtime: runtime + ((k * 7) % 9) - 4 }));
    return { n: i + 1, episodes };
  });
}

interface Base {
  id: string;
  name: string;
  year: number;
  genres: string[];
  rating: string;
  score: number;
  synopsis: string;
  art: string;
  offers: Offer[];
  lists?: ListId[];
  cast?: Person[];
  crew?: Person[];
}

const movie = (b: Base & { runtime: number }): Title => ({ kind: 'movie', lists: [], cast: [], crew: [], ...b });
const show = (b: Base & { seasons: Season[]; next?: Title['next'] }): Title => ({
  kind: 'show',
  lists: [],
  cast: [],
  crew: [],
  ...b,
});

export const TITLES: Title[] = [
  // ---- Movies in the imported watchlists (16) ----
  movie({
    id: 'arrival', name: 'Arrival', year: 2016, genres: ['Sci-fi', 'Drama'], runtime: 116, rating: 'PG-13', score: 7.9,
    synopsis: 'Mysterious spacecraft touch down around the globe, and linguist Louise Banks races to understand the visitors before fear pushes the world to war.',
    art: 'arrival.jpg', offers: [sub('prime'), ...stores(39, 99)], lists: ['my'],
    cast: [p('Amy Adams', 'Louise Banks'), p('Jeremy Renner', 'Ian Donnelly'), p('Forest Whitaker', 'Col. Weber'), p('Michael Stuhlbarg', 'Agent Halpern'), p('Tzi Ma', 'General Shang')],
    crew: [p('Denis Villeneuve', 'Director')],
  }),
  movie({
    id: 'dune', name: 'Dune: Part Two', year: 2024, genres: ['Sci-fi', 'Adventure'], runtime: 166, rating: 'PG-13', score: 8.5,
    synopsis: 'Paul Atreides unites with Chani and the Fremen on a path of revenge against the conspirators who destroyed his family.',
    art: 'dune.jpg', offers: [sub('max'), ...stores(59, 199)], lists: ['my'],
    cast: [p('Timothée Chalamet', 'Paul Atreides'), p('Zendaya', 'Chani'), p('Rebecca Ferguson', 'Lady Jessica'), p('Javier Bardem', 'Stilgar'), p('Austin Butler', 'Feyd-Rautha')],
    crew: [p('Denis Villeneuve', 'Director')],
  }),
  movie({
    id: 'past-lives', name: 'Past Lives', year: 2023, genres: ['Drama', 'Romance'], runtime: 106, rating: 'PG-13', score: 7.9,
    synopsis: 'Two deeply connected childhood friends are wrested apart, then reunite two decades later for one fateful week in New York.',
    art: 'past-lives.jpg', offers: [sub('viaplay'), ...stores()], lists: ['my'],
    cast: [p('Greta Lee', 'Nora'), p('Teo Yoo', 'Hae Sung'), p('John Magaro', 'Arthur')],
    crew: [p('Celine Song', 'Director')],
  }),
  movie({
    id: 'mitchells', name: 'The Mitchells vs. the Machines', year: 2021, genres: ['Animation', 'Comedy'], runtime: 114, rating: 'PG', score: 7.6,
    synopsis: 'A quirky family road trip is upended when the world’s devices rise up, and the Mitchells become humanity’s unlikely last hope.',
    art: 'mitchells.jpg', offers: [sub('netflix')], lists: ['friends'],
    cast: [p('Abbi Jacobson', 'Katie Mitchell'), p('Danny McBride', 'Rick Mitchell'), p('Maya Rudolph', 'Linda Mitchell'), p('Mike Rianda', 'Aaron Mitchell')],
    crew: [p('Mike Rianda', 'Director')],
  }),
  movie({
    id: 'coda', name: 'CODA', year: 2021, genres: ['Drama'], runtime: 111, rating: 'PG-13', score: 8.0,
    synopsis: 'The only hearing member of a deaf family discovers a passion for singing and must choose between her dream and the family fishing business.',
    art: 'coda.jpg', offers: [sub('appletvplus')], lists: ['household'],
    cast: [p('Emilia Jones', 'Ruby Rossi'), p('Troy Kotsur', 'Frank Rossi'), p('Marlee Matlin', 'Jackie Rossi'), p('Daniel Durant', 'Leo Rossi')],
    crew: [p('Siân Heder', 'Director')],
  }),
  movie({
    id: 'moon', name: 'Moon', year: 2009, genres: ['Sci-fi', 'Mystery'], runtime: 97, rating: 'R', score: 7.8,
    synopsis: 'Near the end of a three-year solo stint mining helium-3 on the far side of the Moon, an astronaut makes a discovery that changes everything.',
    art: 'moon.jpg', offers: stores(49, 149), lists: ['household'],
    cast: [p('Sam Rockwell', 'Sam Bell'), p('Dominique McElligott', 'Tess Bell')],
    crew: [p('Duncan Jones', 'Director')],
  }),
  movie({
    id: 'knives-out', name: 'Knives Out', year: 2019, genres: ['Mystery', 'Comedy'], runtime: 130, rating: 'PG-13', score: 7.9,
    synopsis: 'A renowned crime novelist dies just after his 85th birthday, and an inquisitive detective is hired to investigate his eccentric family.',
    art: 'knives-out.jpg', offers: [sub('netflix'), ...stores()], lists: ['friends'],
    cast: [p('Daniel Craig', 'Benoit Blanc'), p('Ana de Armas', 'Marta Cabrera'), p('Chris Evans', 'Ransom Drysdale'), p('Jamie Lee Curtis', 'Linda Drysdale')],
    crew: [p('Rian Johnson', 'Director')],
  }),
  movie({
    id: 'budapest', name: 'The Grand Budapest Hotel', year: 2014, genres: ['Comedy'], runtime: 100, rating: 'R', score: 8.1,
    synopsis: 'A legendary concierge and his trusted lobby boy are caught up in the theft of a priceless painting and a battle for a family fortune.',
    art: 'budapest.jpg', offers: [sub('disney'), ...stores(29, 99)], lists: ['household'],
    cast: [p('Ralph Fiennes', 'M. Gustave'), p('Tony Revolori', 'Zero Moustafa'), p('Saoirse Ronan', 'Agatha'), p('Willem Dafoe', 'J.G. Jopling')],
    crew: [p('Wes Anderson', 'Director')],
  }),
  movie({
    id: 'eeaao', name: 'Everything Everywhere All at Once', year: 2022, genres: ['Sci-fi', 'Comedy'], runtime: 139, rating: 'R', score: 7.8,
    synopsis: 'A laundromat owner audited by the IRS discovers she must connect with parallel-universe versions of herself to save the multiverse.',
    art: 'dune.jpg', offers: [sub('viaplay'), ...stores()], lists: ['household'],
    cast: [p('Michelle Yeoh', 'Evelyn Wang'), p('Ke Huy Quan', 'Waymond Wang'), p('Stephanie Hsu', 'Joy Wang'), p('Jamie Lee Curtis', 'Deirdre Beaubeirdre')],
    crew: [p('Daniel Kwan', 'Director'), p('Daniel Scheinert', 'Director')],
  }),
  movie({
    id: 'oppenheimer', name: 'Oppenheimer', year: 2023, genres: ['Drama', 'History'], runtime: 180, rating: 'R', score: 8.3,
    synopsis: 'The story of J. Robert Oppenheimer and the race to build the atomic bomb, and the security hearing that followed.',
    art: 'past-lives.jpg', offers: [sub('prime'), ...stores(59, 199)], lists: ['my'],
    cast: [p('Cillian Murphy', 'J. Robert Oppenheimer'), p('Emily Blunt', 'Kitty Oppenheimer'), p('Robert Downey Jr.', 'Lewis Strauss'), p('Matt Damon', 'Leslie Groves')],
    crew: [p('Christopher Nolan', 'Director')],
  }),
  movie({
    id: 'killers', name: 'Killers of the Flower Moon', year: 2023, genres: ['Drama', 'Crime'], runtime: 206, rating: 'R', score: 7.6,
    synopsis: 'Members of the Osage Nation are murdered under mysterious circumstances in 1920s Oklahoma, sparking a major FBI investigation.',
    art: 'arrival.jpg', offers: [sub('appletvplus')], lists: ['household'],
    cast: [p('Leonardo DiCaprio', 'Ernest Burkhart'), p('Lily Gladstone', 'Mollie Burkhart'), p('Robert De Niro', 'William Hale')],
    crew: [p('Martin Scorsese', 'Director')],
  }),
  movie({
    id: 'poor-things', name: 'Poor Things', year: 2023, genres: ['Comedy', 'Sci-fi'], runtime: 141, rating: 'R', score: 7.8,
    synopsis: 'Brought back to life by an unorthodox scientist, Bella Baxter runs off on a whirlwind adventure across the continents.',
    art: 'mitchells.jpg', offers: [sub('viaplay'), ...stores()], lists: ['friends'],
    cast: [p('Emma Stone', 'Bella Baxter'), p('Mark Ruffalo', 'Duncan Wedderburn'), p('Willem Dafoe', 'Godwin Baxter')],
    crew: [p('Yorgos Lanthimos', 'Director')],
  }),
  movie({
    id: 'maestro', name: 'Maestro', year: 2023, genres: ['Drama', 'Music'], runtime: 129, rating: 'R', score: 6.6,
    synopsis: 'A portrait of the lifelong relationship between Leonard Bernstein and Felicia Montealegre Cohn Bernstein.',
    art: 'coda.jpg', offers: [sub('netflix')], lists: ['my'],
    cast: [p('Bradley Cooper', 'Leonard Bernstein'), p('Carey Mulligan', 'Felicia Montealegre')],
    crew: [p('Bradley Cooper', 'Director')],
  }),
  movie({
    id: 'zone', name: 'The Zone of Interest', year: 2023, genres: ['Drama', 'History'], runtime: 105, rating: 'PG-13', score: 7.4,
    synopsis: 'The commandant of Auschwitz and his wife build a dream life for their family in a house and garden next to the camp.',
    art: 'moon.jpg', offers: [sub('max'), ...stores()], lists: ['household'],
    cast: [p('Christian Friedel', 'Rudolf Höss'), p('Sandra Hüller', 'Hedwig Höss')],
    crew: [p('Jonathan Glazer', 'Director')],
  }),
  movie({
    id: 'anatomy', name: 'Anatomy of a Fall', year: 2023, genres: ['Drama', 'Mystery'], runtime: 151, rating: 'R', score: 7.7,
    synopsis: 'A woman is suspected of her husband’s murder, and their partially sighted son faces a moral dilemma as the main witness.',
    art: 'knives-out.jpg', offers: [sub('viaplay'), ...stores()], lists: ['friends'],
    cast: [p('Sandra Hüller', 'Sandra Voyter'), p('Swann Arlaud', 'Vincent Renzi'), p('Milo Machado-Graner', 'Daniel')],
    crew: [p('Justine Triet', 'Director')],
  }),
  movie({
    id: 'american-fiction', name: 'American Fiction', year: 2023, genres: ['Comedy', 'Drama'], runtime: 117, rating: 'R', score: 7.5,
    synopsis: 'A frustrated novelist writes an outlandish book under a pseudonym to prove a point, and it becomes a runaway hit.',
    art: 'budapest.jpg', offers: [sub('prime'), ...stores()], lists: ['my'],
    cast: [p('Jeffrey Wright', 'Monk Ellison'), p('Sterling K. Brown', 'Cliff Ellison'), p('Issa Rae', 'Sintara Golden')],
    crew: [p('Cord Jefferson', 'Director')],
  }),

  // ---- Shows in the imported watchlists (12) ----
  show({
    id: 'severance', name: 'Severance', year: 2022, genres: ['Sci-fi', 'Thriller'], rating: 'TV-MA', score: 8.7,
    synopsis: 'Office workers at Lumon Industries have their work and personal memories surgically divided, until one team starts to unravel the truth.',
    art: 'severance.jpg', offers: [sub('appletvplus')], lists: ['my'],
    seasons: seasons([['Good News About Hell', 'Half Loop', 'In Perpetuity', 'The You You Are', 'The Grim Barbarity of Optics and Design', 'Hide and Seek', 'Defiant Jazz', 'What’s for Dinner?', 'The We We Are'], 10], 52),
    next: { season: 1, episode: 3 },
    cast: [p('Adam Scott', 'Mark S.'), p('Britt Lower', 'Helly R.'), p('Zach Cherry', 'Dylan G.'), p('John Turturro', 'Irving B.'), p('Patricia Arquette', 'Harmony Cobel')],
    crew: [p('Dan Erickson', 'Creator')],
  }),
  show({
    id: 'the-bear', name: 'The Bear', year: 2022, genres: ['Comedy', 'Drama'], rating: 'TV-MA', score: 8.5,
    synopsis: 'A young chef from the fine-dining world comes home to Chicago to run his family’s chaotic sandwich shop.',
    art: 'the-bear.jpg', offers: [sub('viaplay')], lists: ['my'],
    seasons: seasons([['System', 'Hands', 'Brigade', 'Dogs', 'Sheridan', 'Ceres', 'Review', 'Braciole'], 10, 10], 30),
    next: { season: 1, episode: 1 },
    cast: [p('Jeremy Allen White', 'Carmy Berzatto'), p('Ayo Edebiri', 'Sydney Adamu'), p('Ebon Moss-Bachrach', 'Richie Jerimovich')],
    crew: [p('Christopher Storer', 'Creator')],
  }),
  show({
    id: 'dark', name: 'Dark', year: 2017, genres: ['Sci-fi', 'Mystery'], rating: 'TV-MA', score: 8.7,
    synopsis: 'A missing child sets four families on a frantic hunt for answers that spans three generations in a small German town.',
    art: 'dark.jpg', offers: [sub('netflix')], lists: ['friends'],
    seasons: seasons([10, 8, 8], 55), next: { season: 2, episode: 4 },
    cast: [p('Louis Hofmann', 'Jonas Kahnwald'), p('Lisa Vicari', 'Martha Nielsen'), p('Oliver Masucci', 'Ulrich Nielsen')],
    crew: [p('Baran bo Odar', 'Creator'), p('Jantje Friese', 'Creator')],
  }),
  show({
    id: 'last-of-us', name: 'The Last of Us', year: 2023, genres: ['Drama', 'Sci-fi'], rating: 'TV-MA', score: 8.7,
    synopsis: 'Twenty years after a pandemic, a hardened survivor is hired to smuggle a 14-year-old girl out of an oppressive quarantine zone.',
    art: 'last-of-us.jpg', offers: [sub('max')], lists: ['household'],
    seasons: seasons([9, 7], 58), next: { season: 1, episode: 1 },
    cast: [p('Pedro Pascal', 'Joel Miller'), p('Bella Ramsey', 'Ellie Williams')],
    crew: [p('Craig Mazin', 'Creator'), p('Neil Druckmann', 'Creator')],
  }),
  show({
    id: 'shogun', name: 'Shōgun', year: 2024, genres: ['Drama', 'History'], rating: 'TV-MA', score: 8.6,
    synopsis: 'In feudal Japan, a shipwrecked English sailor becomes entangled in the struggle of a powerful lord fighting for his life.',
    art: 'shogun.jpg', offers: [sub('viaplay')], lists: ['household'],
    seasons: seasons([10], 60), next: { season: 1, episode: 1 },
    cast: [p('Hiroyuki Sanada', 'Yoshii Toranaga'), p('Cosmo Jarvis', 'John Blackthorne'), p('Anna Sawai', 'Toda Mariko')],
    crew: [p('Rachel Kondo', 'Creator'), p('Justin Marks', 'Creator')],
  }),
  show({
    id: 'fallout', name: 'Fallout', year: 2024, genres: ['Sci-fi', 'Drama'], rating: 'TV-MA', score: 8.3,
    synopsis: 'Two hundred years after the apocalypse, a gentle vault dweller ventures out into the irradiated wasteland of Los Angeles.',
    art: 'fallout.jpg', offers: [sub('prime')], lists: ['my'],
    seasons: seasons([8], 58), next: { season: 1, episode: 5 },
    cast: [p('Ella Purnell', 'Lucy MacLean'), p('Walton Goggins', 'The Ghoul'), p('Aaron Moten', 'Maximus')],
    crew: [p('Graham Wagner', 'Creator'), p('Geneva Robertson-Dworet', 'Creator')],
  }),
  show({
    id: 'our-planet', name: 'Our Planet', year: 2019, genres: ['Documentary'], rating: 'TV-G', score: 9.3,
    synopsis: 'A look at the breathtaking diversity of habitats around the world, and what we stand to lose.',
    art: 'our-planet.jpg', offers: [sub('netflix')], lists: ['household'],
    seasons: seasons([8, 4], 50), next: { season: 1, episode: 2 },
    cast: [p('David Attenborough', 'Narrator')], crew: [p('Alastair Fothergill', 'Producer')],
  }),
  show({
    id: 'microcosmos', name: 'Journey to the Microcosmos', year: 2019, genres: ['Documentary'], rating: 'TV-G', score: 8.8,
    synopsis: 'Close-up footage of the tiny organisms that live all around us, with gentle narration about how they live.',
    art: 'microcosmos.jpg', offers: [free('youtube')], lists: ['friends'],
    seasons: seasons([12], 12), next: { season: 1, episode: 1 },
    cast: [p('Hank Green', 'Narrator')], crew: [p('James Weiss', 'Microscopist')],
  }),
  show({
    id: 'peripheral', name: 'The Peripheral', year: 2022, genres: ['Sci-fi', 'Thriller'], rating: 'TV-MA', score: 7.6,
    synopsis: 'A gamer in rural America is offered a beta test that turns out to be a window into a dangerous future London.',
    art: 'peripheral.jpg', offers: [sub('prime')], lists: ['friends'],
    seasons: seasons([8], 60), next: { season: 1, episode: 1 },
    cast: [p('Chloë Grace Moretz', 'Flynne Fisher'), p('Gary Carr', 'Wilf Netherton'), p('Jack Reynor', 'Burton Fisher')],
    crew: [p('Scott B. Smith', 'Creator')],
  }),
  show({
    id: 'the-crown', name: 'The Crown', year: 2016, genres: ['Drama', 'History'], rating: 'TV-MA', score: 8.6,
    synopsis: 'The reign of Queen Elizabeth II, and the political rivalries and romances that shaped the second half of the 20th century.',
    art: 'shogun.jpg', offers: [sub('netflix')], lists: ['household'],
    seasons: seasons([10, 10, 10, 10, 10, 10], 58), next: { season: 3, episode: 2 },
    cast: [p('Claire Foy', 'Queen Elizabeth II'), p('Olivia Colman', 'Queen Elizabeth II'), p('Matt Smith', 'Prince Philip')],
    crew: [p('Peter Morgan', 'Creator')],
  }),
  show({
    id: 'wheel-of-time', name: 'The Wheel of Time', year: 2021, genres: ['Fantasy', 'Adventure'], rating: 'TV-14', score: 7.1,
    synopsis: 'A powerful sorceress sets out with five young villagers, one of whom may be the prophesied Dragon Reborn.',
    art: 'fallout.jpg', offers: [sub('prime')], lists: ['my'],
    seasons: seasons([8, 8, 8], 60), next: { season: 2, episode: 1 },
    cast: [p('Rosamund Pike', 'Moiraine Damodred'), p('Josha Stradowski', 'Rand al’Thor')],
    crew: [p('Rafe Judkins', 'Creator')],
  }),
  show({
    id: 'blue-planet', name: 'Blue Planet II', year: 2017, genres: ['Documentary'], rating: 'TV-G', score: 9.3,
    synopsis: 'A journey through the world’s oceans, from coral reefs to the deep sea, revealing new creatures and behaviour.',
    art: 'our-planet.jpg', offers: [sub('max')], lists: ['my'],
    seasons: seasons([7], 50), next: { season: 1, episode: 1 },
    cast: [p('David Attenborough', 'Narrator')], crew: [p('James Honeyborne', 'Producer')],
  }),

  // ---- Catalogue-only titles, so search finds more than the library ----
  show({ id: 'carnival-row', name: 'Carnival Row', year: 2019, genres: ['Fantasy', 'Mystery'], rating: 'TV-MA', score: 7.7,
    synopsis: 'In a Victorian fantasy city, a human detective and a fairy refugee rekindle a dangerous affair amid a string of murders.',
    art: 'dark.jpg', offers: [sub('prime')], seasons: seasons([8, 10], 55), next: { season: 1, episode: 1 },
    cast: [p('Orlando Bloom', 'Rycroft Philostrate'), p('Cara Delevingne', 'Vignette Stonemoss')] }),
  movie({ id: 'the-arrival-1996', name: 'The Arrival', year: 1996, genres: ['Sci-fi', 'Thriller'], runtime: 115, rating: 'PG-13', score: 6.3,
    synopsis: 'A radio astronomer picks up a signal from deep space and uncovers a hidden presence on Earth.',
    art: 'moon.jpg', offers: unpriced('rakuten'),
    cast: [p('Charlie Sheen', 'Zane Zaminsky'), p('Lindsay Crouse', 'Ilana Green')] }),
  movie({ id: 'blade-runner-2049', name: 'Blade Runner 2049', year: 2017, genres: ['Sci-fi', 'Drama'], runtime: 164, rating: 'R', score: 8.0,
    synopsis: 'A young blade runner’s discovery of a long-buried secret leads him to track down a former blade runner who has been missing for 30 years.',
    art: 'dune.jpg', offers: stores(39, 129),
    cast: [p('Ryan Gosling', 'K'), p('Harrison Ford', 'Rick Deckard'), p('Ana de Armas', 'Joi')], crew: [p('Denis Villeneuve', 'Director')] }),
  movie({ id: 'interstellar', name: 'Interstellar', year: 2014, genres: ['Sci-fi', 'Adventure'], runtime: 169, rating: 'PG-13', score: 8.7,
    synopsis: 'A team of explorers travels through a wormhole in space in an attempt to ensure humanity’s survival.',
    art: 'moon.jpg', offers: [...stores(39, 99), ...unpriced('rakuten')],
    cast: [p('Matthew McConaughey', 'Cooper'), p('Anne Hathaway', 'Brand'), p('Jessica Chastain', 'Murph')], crew: [p('Christopher Nolan', 'Director')] }),
  movie({ id: 'marvel-one-shots', name: 'Marvel One-Shots', year: 2011, genres: ['Action'], runtime: 60, rating: 'PG-13', score: 6.9,
    synopsis: 'A collection of short films that expand the stories around the Marvel Cinematic Universe.',
    art: 'mitchells.jpg', offers: [sub('disney')] }),
  show({ id: 'larva-island', name: 'Larva Island', year: 2018, genres: ['Animation', 'Comedy'], rating: 'TV-Y7', score: 7.2,
    synopsis: 'Two larvae shipwrecked on a tropical island get up to slapstick mischief with a stranded human.',
    art: 'budapest.jpg', offers: [sub('netflix')], seasons: seasons([26], 7), next: { season: 1, episode: 1 } }),
  movie({ id: 'carnival-of-souls', name: 'Carnival of Souls', year: 1962, genres: ['Horror'], runtime: 78, rating: 'NR', score: 7.0,
    synopsis: 'After surviving a car accident, a church organist is drawn to an abandoned pavilion by a ghostly figure.',
    art: 'knives-out.jpg', offers: [free('youtube')] }),
  show({ id: 'mrs-maisel', name: 'The Marvelous Mrs. Maisel', year: 2017, genres: ['Comedy', 'Drama'], rating: 'TV-MA', score: 8.7,
    synopsis: 'A 1950s housewife discovers she has a knack for stand-up comedy and leaves her life behind to pursue it.',
    art: 'past-lives.jpg', offers: [sub('prime')], seasons: seasons([8, 10, 8, 8, 9], 55), next: { season: 1, episode: 1 },
    cast: [p('Rachel Brosnahan', 'Midge Maisel'), p('Alex Borstein', 'Susie Myerson')] }),
  show({ id: 'marvel-assembled', name: 'Marvel Studios: Assembled', year: 2021, genres: ['Documentary'], rating: 'TV-PG', score: 7.4,
    synopsis: 'Behind-the-scenes looks at how Marvel Studios’ films and series were made.',
    art: 'severance.jpg', offers: [sub('disney')], seasons: seasons([12], 45), next: { season: 1, episode: 1 } }),
  show({ id: 'daredevil', name: 'Marvel’s Daredevil', year: 2015, genres: ['Action', 'Crime'], rating: 'TV-MA', score: 8.6,
    synopsis: 'A blind lawyer by day fights crime as a masked vigilante in New York’s Hell’s Kitchen by night.',
    art: 'the-bear.jpg', offers: [buy('appletv', { HD: 199, '4K': 249 }, true), buy('viaplaystore', { HD: 219 }, true)], seasons: seasons([13, 13, 13], 55), next: { season: 1, episode: 1 },
    cast: [p('Charlie Cox', 'Matt Murdock'), p('Vincent D’Onofrio', 'Wilson Fisk')] }),
  movie({ id: 'harvey-girls', name: 'The Harvey Girls', year: 1946, genres: ['Musical', 'Western'], runtime: 102, rating: 'NR', score: 6.8,
    synopsis: 'A group of young women travel west to work as waitresses at a new restaurant in a rowdy frontier town.',
    art: 'coda.jpg', offers: [rent('appletv', { HD: 29 }), buy('appletv', { HD: 99 })],
    cast: [p('Judy Garland', 'Susan Bradley'), p('John Hodiak', 'Ned Trent')] }),
  show({ id: 'carnival-eats', name: 'Carnival Eats', year: 2014, genres: ['Food'], rating: 'TV-G', score: 7.0,
    synopsis: 'A food lover tours fairs and carnivals across North America in search of the most outrageous treats.',
    art: 'dune.jpg', offers: [sub('viaplay')], seasons: seasons([13, 13], 22), next: { season: 1, episode: 1 } }),
  show({ id: 'carnivale', name: 'Carnivàle', year: 2003, genres: ['Drama', 'Fantasy'], rating: 'TV-MA', score: 8.1,
    synopsis: 'During the Dust Bowl, a young fugitive with healing powers joins a travelling carnival caught up in a battle between good and evil.',
    art: 'moon.jpg', offers: [sub('max')], seasons: seasons([12, 12], 55), next: { season: 1, episode: 1 } }),
  show({ id: '911', name: '9-1-1', year: 2018, genres: ['Drama', 'Action'], rating: 'TV-14', score: 7.8,
    synopsis: 'First responders in Los Angeles balance high-pressure emergencies with their own personal lives.',
    art: 'last-of-us.jpg', offers: [sub('viaplay')], seasons: seasons([10, 18, 18], 43), next: { season: 1, episode: 1 } }),
  show({ id: '911-lone-star', name: '9-1-1: Lone Star', year: 2020, genres: ['Drama', 'Action'], rating: 'TV-14', score: 7.4,
    synopsis: 'A New York firefighter and his son move to Austin to rebuild a firehouse after a tragedy.',
    art: 'fallout.jpg', offers: [sub('viaplay')], seasons: seasons([10, 14], 43), next: { season: 1, episode: 1 } }),
];

export const byId = new Map(TITLES.map((t) => [t.id, t]));

export function getTitle(id: string): Title {
  const t = byId.get(id);
  if (!t) throw new Error(`Unknown title ${id}`);
  return t;
}

export const GENRES = [...new Set(([] as string[]).concat(...TITLES.map((t) => t.genres)))].sort();
