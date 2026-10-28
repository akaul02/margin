import { useEffect, useRef } from 'react';
import { driver, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { calm, SealGuide, typeOut } from './seal';

/* A hands-on walkthrough of the synthetic demo, in the style of a game tutorial: each step
   spotlights the real control, and moves on by itself once the reader has done the thing.
   Ceal, the lab's seal, rides along beside each step's bubble. */
export type TutorialState = { view: string; selection: boolean; quotes: number; groups: number; grouped: number; notes: number };
type Step = { element: string | (() => Element); title: string; text: string; done?: (s: TutorialState) => boolean };

export const tutorialSteps: Step[] = [
  // The core loop, hands-on: each step moves on by itself once it is done.
  {
    element: '[data-nav="read"]',
    title: 'Hi, I’m Ceal!',
    text: 'Let’s sort a practice interview together. Click Transcripts.',
    done: s => s.view === 'read',
  },
  {
    element: '.turn.participant',
    title: 'Find a good quote',
    text: 'Drag across something the participant said.',
    done: s => s.selection || s.quotes > 0,
  },
  {
    element: '.file-list',
    title: 'Put it on the board',
    text: 'Press 0, or click Ungrouped. The words become a sticky.',
    done: s => s.quotes > 0,
  },
  {
    element: '.selection-placeholder .file-actions button',
    title: 'Make a group',
    text: 'Click New group and name what the quote is about.',
    done: s => s.groups > 0,
  },
  {
    element: '.turn-list',
    title: 'Now the fast way',
    text: 'Highlight another sentence and press 1. It goes straight into your group.',
    done: s => s.grouped > 0,
  },
  { element: '[data-nav="board"]', title: 'Let’s see the wall', text: 'Click Board.', done: s => s.view === 'board' },
  {
    element: '.board-wall',
    title: 'This is your wall',
    text: 'Each group is a column of stickies in its own color. Drag a sticky to another group to move it. Big boards get a map on top.',
  },
  {
    // The whole column, so the note being written stays clickable under the spotlight.
    element: () => document.querySelector('.add-note')?.closest('.board-group') ?? document.body,
    title: 'Add your own thoughts',
    text: 'Click Add note, write an idea, and press Enter.',
    done: s => s.notes > 0,
  },
  // A quick look at everything else.
  {
    element: '.board-wall .board-group:not(.ungrouped) .board-column-head',
    title: 'Group labels',
    text: 'Edit renames a group or adds a description. Read more opens it.',
  },
  {
    element: '.board-actions',
    title: 'Find and share',
    text: 'All quotes lists every quote. Work together shares the board with co-authors.',
  },
  {
    element: '[data-nav="memos"]',
    title: 'Memos',
    text: 'Write what your groups add up to. Memos stay separate from participants’ words.',
  },
  {
    element: '[data-nav="workbench"]',
    title: 'Codes',
    text: 'Optional: a codebook, themes and a coding map when you want more structure.',
  },
  { element: '.top-actions', title: 'Safe to experiment', text: 'Undo takes back your last change. History keeps restore points.' },
  { element: '.export-button', title: 'Keep a copy', text: 'Export downloads a backup or spreadsheets of your board.' },
  {
    element: '.board-wall',
    title: 'That’s everything!',
    text: 'Now try it with your own interviews. Replay me anytime from the ? button.',
  },
];

export function useTutorial(active: boolean, state: TutorialState, end: () => void) {
  const tour = useRef<Driver | null>(null);
  const seal = useRef<SealGuide | null>(null);
  const endRef = useRef(end);
  endRef.current = end;
  useEffect(() => {
    if (!active) return;
    const guide = new SealGuide();
    seal.current = guide;
    let stopTyping = () => undefined as void;
    let finished = false,
      gone = false;
    const goodbye = () => {
      if (gone) return;
      gone = true;
      stopTyping();
      void guide.leave(finished);
    };
    const drv = driver({
      showProgress: true,
      progressText: 'Step {{current}} of {{total}}',
      allowKeyboardControl: false,
      overlayOpacity: 0.3,
      stagePadding: 6,
      stageRadius: 8,
      popoverClass: 'margin-coach',
      doneBtnText: 'Finish',
      nextBtnText: 'Next',
      steps: tutorialSteps.map(s => ({
        element: s.element,
        // Hands-on steps wait for the reader; overview steps have a Next button.
        popover: { title: s.title, description: s.text, showButtons: s.done ? ['close'] : ['next', 'close'] },
      })),
      onPopoverRender: (popover, { driver: d }) => {
        popover.closeButton.setAttribute('aria-label', 'Skip tutorial');
        popover.closeButton.title = 'Skip tutorial';
        stopTyping();
        stopTyping = typeOut(popover.description, guide);
        const last = d.isLastStep();
        // Wait for driver.js to place the bubble, then Ceal hops over to it; the last step gets a finale.
        requestAnimationFrame(
          () =>
            void guide.join(popover.wrapper, d.getActiveElement()).then(() => {
              if (last) void guide.cheer(true);
            }),
        );
      },
      onDeselected: () => guide.hold(),
      onNextClick: (_el, _step, { driver: d }) => {
        if (d.isLastStep()) finished = true;
        d.moveNext();
      },
      // Skip and Finish both land here; ending the state lets the effect cleanup destroy the tour.
      onDestroyStarted: () => {
        goodbye();
        endRef.current();
      },
    });
    tour.current = drv;
    const watch = setInterval(() => {
      if (!gone && drv.isActive()) guide.keepUp(document.querySelector<HTMLElement>('.driver-popover'), drv.getActiveElement());
    }, 400);
    // Wait a frame so the first target is on screen.
    const start = requestAnimationFrame(() => drv.drive(0));
    return () => {
      cancelAnimationFrame(start);
      clearInterval(watch);
      goodbye();
      tour.current = null;
      seal.current = null;
      drv.destroy();
    };
  }, [active]);
  const pending = useRef(-1);
  useEffect(() => {
    const drv = tour.current;
    if (!active || !drv?.isActive()) return;
    const i = drv.getActiveIndex() ?? 0;
    if (!tutorialSteps[i]?.done?.(state)) return;
    let next = i + 1;
    while (next < tutorialSteps.length - 1 && tutorialSteps[next].done?.(state)) next++;
    if (pending.current === next) return;
    pending.current = next;
    void seal.current?.cheer();
    // Let the view render the next target, and Ceal clap, before the spotlight moves. Re-renders must not postpone it.
    setTimeout(
      () => {
        pending.current = -1;
        if (drv.isActive()) drv.moveTo(next);
      },
      calm() ? 120 : 520,
    );
  });
}
