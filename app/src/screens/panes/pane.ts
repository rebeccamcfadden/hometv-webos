// One section's pane in Settings (design_preview's screens/panes/pane.ts at 2bf3c2d), shared with first run. Made once
// per page, so a sub-state (Change city, an app being moved) survives moving between sections.
import type { Key } from '../../shell/app';
import { h, type Child } from '../../shell/dom';

export interface Pane {
  /** The pane's content, built afresh each time it shows or its data changes. Focus comes back by key. */
  render(): Child;
  /** Back inside the pane: leaves a sub-state and returns true; false lets the page take focus to the section. */
  back?(): boolean;
  /** Arrows and OK inside the pane, before the page's own handling; true when used. */
  onKey?(key: Key, focused: HTMLElement): boolean;
  /** Typing from a keyboard or the remote's number keys, for the city search. */
  onText?(ch: string): boolean;
}

/** What a pane can ask of the page around it. */
export interface PaneHost {
  /** Rebuilds the pane that is showing (after a sub-state change), keeping focus by key. */
  rerender(): void;
  /** Focuses the element with this key in the pane, after a rerender; with none, the pane's first item. */
  focusKey(key?: string): void;
  /** First run, where some wording differs. */
  setup: boolean;
}

export const paneHead = (eyebrow: string, title: string, sub?: string) => [
  h('div.eyebrow', eyebrow),
  h('div.pane-title', title),
  sub ? h('div.pane-sub', sub) : null,
];
