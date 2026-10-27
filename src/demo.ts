import { newProject, makeTranscript } from './model';
/** The practice project. Tests pass `withGarden` for a second synthetic interview. */
export function demoProject(withGarden = false) {
  const p = newProject('Everyday places', true);
  const texts = [
    ['A visit to the neighborhood library', `Interviewer: Tell me about the last time you visited the library.

Participant: I went on a Tuesday after work. I was looking for somewhere quiet, but I also wanted to be around other people. The library lets me do both.

Interviewer: What was it like when you arrived?

Participant: The person at the front desk recognized me. They asked if I had finished the book from last week. It was a small thing, but it made the place feel familiar.

Interviewer: Was there anything that made the visit difficult?

Participant: The bus only comes once an hour in the evening. I kept checking the time instead of settling into what I was reading. Sometimes I leave early just so I do not miss it.

Interviewer: Is there anything else you would like to share?

Participant: I like that I can stay without buying anything. Some days I read, and some days I just sit by the window. Nobody asks me to explain why I am there.`],
    ['An afternoon in the community garden', `Interviewer: How did you first hear about the garden?

Participant: A neighbor invited me when I moved in. I did not know much about growing things, so I watched for the first few weekends. Eventually someone asked me to help water.

Interviewer: What keeps you coming back?

Participant: We trade little bits of advice while we work. Last week I learned when to pick the beans. I feel more comfortable asking questions here than I did at the beginning.

Interviewer: What would make it easier to visit?

Participant: The gate is sometimes locked when the sign says it should be open. I would like to know the hours before I walk over. It is a long walk with all my tools.`]
  ];
  p.transcripts = (withGarden ? texts : texts.slice(0, 1)).map(([name, text]) => { const t = makeTranscript(name, text); t.turns.forEach(turn => turn.role = turn.label === 'Participant' ? 'participant' : 'interviewer'); return t; });
  return p;
}
