import { DRILL_IDS, type DrillId, type DrillReport } from '@shared/types.js';
import { applyStatic, onLangChange, t, type Key } from '../i18n.js';

/**
 * The two bits of training UI: the picker on the front end, and the panel that
 * sits over the pitch counting whatever the drill counts.
 */
export class DrillPicker {
  private list = document.getElementById('drill-list')!;

  constructor(onPick: (drill: DrillId) => void) {
    const build = (): void => {
      this.list.replaceChildren(
        ...DRILL_IDS.map((id) => {
          const card = document.createElement('button');
          card.className = 'drill-card';
          const name = document.createElement('b');
          name.textContent = t(`drill.${id}` as Key);
          const blurb = document.createElement('em');
          blurb.textContent = t(`drill.${id}.blurb` as Key);
          card.append(name, blurb);
          card.addEventListener('click', () => onPick(id));
          return card;
        }),
      );
    };
    build();
    onLangChange(build);
  }
}

export class DrillPanel {
  private root = document.getElementById('drill')!;
  private title = document.getElementById('drill-title')!;
  private prompt = document.getElementById('drill-prompt')!;
  private stats = document.getElementById('drill-stats')!;
  private report: DrillReport | null = null;

  constructor() {
    onLangChange(() => this.render());
  }

  show(report: DrillReport): void {
    this.report = report;
    this.root.classList.remove('hidden');
    this.render();
  }

  hide(): void {
    this.report = null;
    this.root.classList.add('hidden');
  }

  private render(): void {
    const r = this.report;
    if (!r) return;
    this.title.textContent = t(`drill.${r.drill === 'tutorial' ? 'free' : r.drill}` as Key);
    this.prompt.textContent = t(r.promptKey as Key);
    this.stats.replaceChildren(
      ...r.stats.map((s) => {
        const cell = document.createElement('div');
        const value = document.createElement('b');
        value.textContent = s.value;
        cell.append(value, document.createTextNode(t(s.key as Key)));
        return cell;
      }),
    );
    applyStatic(this.root);
  }
}
