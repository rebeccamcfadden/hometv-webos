// Opening a title, or a store's app, from the title page and its rent dialog: through the bridge (titleLinks.ts says
// how), with what happened in the toast.
import type { ServiceId, Title } from '@hometv/core/types.ts';
import { bridge } from '../bridge';
import { shell } from '../shell/app';
import { linkFor, openPlan, type OpenPlan } from '../titleLinks';

export async function openWith(plan: OpenPlan, message: string): Promise<void> {
  const name = plan.app.name;
  shell.toast(message);
  const r = await bridge.openTitle(plan);
  if (!r.ok && r.error === 'not on this TV') shell.toast(`${name} isn’t on this TV. Samsung’s Apps can add it.`, true);
  else if (!r.ok) shell.toast(`${name} didn’t open: ${r.error}`, true);
  else if (!r.id) shell.toast(`Preview: on the TV this opens ${name}.`);
  else if (plan.how === 'link' && !r.linked) shell.toast(`${name} opens on its home: the title link didn’t go through.`);
  else shell.toast(`${message.replace(/…$/, '')} (${r.id}).`);
}

/** Opens `t` in a service's app: the title itself where a link is known, else the app. */
export function openTitleIn(t: Title, service: ServiceId, what = t.name): Promise<void> {
  const plan = openPlan(service, linkFor(t, service));
  return openWith(plan, `Opening ${what} in ${plan.app.name}…`);
}
