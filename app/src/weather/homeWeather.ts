// Home's weather: the Open-Meteo store (weatherStore.ts) for the place and unit chosen in Settings.

import { bridge } from '../bridge';
import { fahrenheit, pageStorage, prefs } from '../launcherSettings';
import { getText } from '../net';
import { forecastUrl } from './openMeteo';
import { createWeather } from './weatherStore';

export const weather = createWeather({
  storage: pageStorage(),
  get: (url) => getText(url),
  now: () => Date.now(),
  online: () => bridge.platform.online(),
});

function follow() {
  const p = prefs.get();
  weather.use(p.place ? forecastUrl(p.place.latitude, p.place.longitude, fahrenheit(p)) : null);
}
follow();
prefs.on(() => {
  follow();
  weather.refresh();
});
