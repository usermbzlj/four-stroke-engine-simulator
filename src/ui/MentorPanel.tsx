import { useState } from 'react';
import { autoTune, nextLessonStep, quitLesson, startLesson, stopTune } from '../mentor/brain';
import { LESSON } from '../mentor/lessons';
import { dismiss, useMentor, type MentorMessage } from '../mentor/store';
import { TITLES } from '../mentor/voice';

const VISIBLE = 3;

function Message({ m }: { m: MentorMessage }): React.ReactElement {
  return (
    <li className={`mentor-msg mentor-msg--${m.tone}`}>
      <p>
        {m.head && <b>{m.head}</b>}
        {m.text}
      </p>
      {m.actions.length > 0 && (
        <div className="mentor-actions">
          {m.actions.map((a) => (
            <button
              key={a.label}
              type="button"
              className={`btn btn--small${a.primary ? ' btn--mentor' : ''}`}
              onClick={() => {
                a.run();
                dismiss(m.id);
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
      <button type="button" className="mentor-x" onClick={() => dismiss(m.id)} aria-label="知道了">
        ×
      </button>
    </li>
  );
}

export function MentorPanel(): React.ReactElement {
  const open = useMentor((s) => s.open);
  const messages = useMentor((s) => s.messages);
  const protect = useMentor((s) => s.protect);
  const despair = useMentor((s) => s.despair);
  const lesson = useMentor((s) => s.lesson);
  const tuning = useMentor((s) => s.tuning);
  const set = useMentor((s) => s.set);
  const [history, setHistory] = useState(false);

  const urgent = messages.some((m) => m.tone === 'danger');
  if (!open) {
    return (
      <button type="button" className={`mentor-fab${urgent ? ' is-urgent' : ''}`} onClick={() => set({ open: true })} aria-label="打开老周">
        <span className="mentor-face">周</span>
        {messages.length > 0 && <span className="mentor-fab-count">{messages.length}</span>}
      </button>
    );
  }

  const step = lesson !== null ? LESSON[lesson] : undefined;
  const shown = history ? messages : messages.slice(0, VISIBLE);

  return (
    <aside className="mentor" aria-label="老周" aria-live="polite">
      <header className="mentor-head">
        <span className="mentor-face">周</span>
        <div className="mentor-id">
          <b>老周</b>
          <span>{TITLES[Math.min(TITLES.length - 1, Math.floor(despair))]}</span>
        </div>
        <button
          type="button"
          className={`mentor-toggle${protect ? ' is-on' : ''}`}
          onClick={() => set({ protect: !protect })}
          aria-pressed={protect}
          title={protect ? '要炸之前老周会接手。关掉才能真的炸。' : '老周只提醒，不出手。'}
        >
          保护{protect ? '开' : '关'}
        </button>
        <button type="button" className="btn btn--ghost btn--small" onClick={() => set({ open: false })} aria-label="收起老周">
          收起
        </button>
      </header>

      <div className="mentor-tools">
        {tuning ? (
          <button type="button" className="btn btn--small" onClick={() => stopTune()}>
            停下
          </button>
        ) : (
          <button type="button" className="btn btn--small btn--mentor" onClick={() => void autoTune()}>
            老周调一遍
          </button>
        )}
        {lesson === null && (
          <button type="button" className="btn btn--small" onClick={startLesson}>
            带我入门
          </button>
        )}
      </div>

      {step && lesson !== null && (
        <section className="mentor-card mentor-card--lesson">
          <header>
            <span>
              第 {lesson + 1}/{LESSON.length} 步
            </span>
            <b>{step.title}</b>
          </header>
          <p>{step.text()}</p>
          <div className="mentor-actions">
            {step.manual && (
              <button type="button" className="btn btn--small btn--mentor" onClick={nextLessonStep}>
                {step.manual}
              </button>
            )}
            {step.help && (
              <button type="button" className="btn btn--small" onClick={step.help.run}>
                {step.help.label}
              </button>
            )}
            <button type="button" className="btn btn--ghost btn--small" onClick={nextLessonStep}>
              跳过这步
            </button>
            <button type="button" className="btn btn--ghost btn--small" onClick={quitLesson}>
              不学了
            </button>
          </div>
        </section>
      )}

      {tuning && (
        <section className="mentor-card mentor-card--tune">
          <header>
            <span>老周在调</span>
            <b>{tuning.stage}</b>
          </header>
          <ol>
            {tuning.log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ol>
        </section>
      )}

      <ol className={`mentor-msgs${history ? ' is-all' : ''}`}>
        {shown.map((m) => (
          <Message key={m.id} m={m} />
        ))}
      </ol>
      {messages.length > VISIBLE && (
        <button type="button" className="btn btn--ghost btn--small mentor-more" onClick={() => setHistory(!history)}>
          {history ? '只看最新' : `更早的 ${messages.length - VISIBLE} 条`}
        </button>
      )}
    </aside>
  );
}
