import { useEffect, useRef, useState } from "react";
import { Player, TRANSITIONS } from "./player";
import type { Transition } from "./player";
import { addTracks, loadTracks, removeTrack, requestPersist, saveOrder } from "./storage";
import type { LoopMode, Track } from "./types";

function fmt(s: number) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

export default function App() {
  const player = useRef<Player>(null as unknown as Player);
  if (!player.current) player.current = new Player();
  const p = player.current;

  const [tracks, setTracks] = useState<Track[]>([]);
  const [, force] = useState(0);
  const [loop, setLoop] = useState<LoopMode>("off");
  const [transition, setTransition] = useState<Transition>("linear");
  const [fade, setFade] = useState(3);
  const [pauseFade, setPauseFade] = useState(1.5);
  const [volume, setVolume] = useState(1);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  useEffect(() => {
    p.onChange = () => force((n) => n + 1);
    requestPersist();
    loadTracks().then((t) => {
      p.tracks = t;
      setTracks(t);
    });
  }, [p]);

  useEffect(() => {
    const id = setInterval(() => {
      if (!seeking) setTime(p.currentTime);
      setDur(p.duration);
      force((n) => n + 1);
    }, 250);
    return () => clearInterval(id);
  }, [p, seeking]);

  const refresh = async () => {
    const t = await loadTracks();
    p.tracks = t;
    setTracks(t);
  };

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    await addTracks(files);
    await refresh();
  };

  const applyOrder = async (list: Track[]) => {
    p.tracks = list;
    setTracks(list);
    await saveOrder(list.map((t) => t.id));
  };

  const sortByName = (desc: boolean) => {
    const list = [...tracks].sort((a, b) =>
      a.name.localeCompare(b.name, "pt-BR", { numeric: true, sensitivity: "base" })
    );
    applyOrder(desc ? list.reverse() : list);
  };

  const shuffle = () => {
    const list = [...tracks];
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    applyOrder(list);
  };

  const onRemove = async (id: string) => {
    p.stopIfCurrent(id);
    await removeTrack(id);
    await refresh();
  };

  const loops: [LoopMode, string][] = [
    ["off", "Desligado"],
    ["playlist", "Playlist"],
    ["track", "Faixa"],
  ];

  const currentTrack = tracks.find((t) => t.id === p.currentId);
  const hint = TRANSITIONS.find((t) => t.id === transition)?.hint;

  return (
    <main className="app">
      <header className="header">
        <img
          className="logo"
          src="/logo.png"
          alt="O Tribunal dos Miseráveis"
          onError={(e) => (e.currentTarget.style.display = "none")}
        />
        <h1>Trilha Sonora do Tribunal</h1>
        <div className="divider" />
      </header>

      <section className="now card">
        <div className="now-title">
          {currentTrack ? currentTrack.name : "Nenhuma faixa tocando"}
        </div>
        <div className="seek">
          <span>{fmt(time)}</span>
          <input
            type="range"
            min={0}
            max={dur || 1}
            step={0.1}
            value={Math.min(time, dur || 1)}
            disabled={!dur}
            style={{ ["--pct" as string]: `${dur ? (time / dur) * 100 : 0}%` }}
            onPointerDown={() => setSeeking(true)}
            onChange={(e) => setTime(Number(e.target.value))}
            onPointerUp={(e) => {
              p.seek(Number((e.target as HTMLInputElement).value));
              setSeeking(false);
            }}
            onKeyUp={(e) => p.seek(Number((e.target as HTMLInputElement).value))}
          />
          <span>{fmt(dur)}</span>
        </div>
        <div className="controls">
          <button className="round" title="Anterior" onClick={() => p.prev()}>⏮</button>
          <button
            className="round big"
            title={p.playing ? "Pausar (com fade)" : "Tocar"}
            onClick={() => p.toggle()}
          >
            {p.playing ? "⏸" : "▶"}
          </button>
          <button className="round" title="Próxima" onClick={() => p.next()}>⏭</button>
          <button
            className="ghost"
            title="Pausa imediata, sem fade"
            disabled={!p.playing}
            onClick={() => p.pause(false)}
          >
            Pausar direto
          </button>
        </div>
      </section>

      <section className="card">
        <div className="list-head">
          <h2>Playlist</h2>
          <label className="btn">
            + Adicionar músicas
            <input
              type="file"
              multiple
              accept=".mp3,.wav,audio/*"
              onChange={onUpload}
              hidden
            />
          </label>
        </div>
        <div className="sortbar">
          <span className="label">Ordenar</span>
          <button onClick={() => sortByName(false)}>A → Z</button>
          <button onClick={() => sortByName(true)}>Z → A</button>
          <button onClick={shuffle}>Aleatório</button>
        </div>
        <ul>
          {tracks.map((t, i) => (
            <li
              key={t.id}
              draggable
              className={`${t.id === p.currentId ? "current" : ""} ${t.id === dragId ? "dragging" : ""}`}
              onClick={() => p.playTrack(t.id)}
              onDragStart={(e) => {
                setDragId(t.id);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", t.id);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (!dragId || dragId === t.id) return;
                const from = tracks.findIndex((x) => x.id === dragId);
                if (from < 0) return;
                const list = [...tracks];
                const [item] = list.splice(from, 1);
                list.splice(i, 0, item);
                p.tracks = list;
                setTracks(list);
              }}
              onDrop={(e) => e.preventDefault()}
              onDragEnd={() => {
                setDragId(null);
                saveOrder(tracks.map((x) => x.id));
              }}
            >
              <span className="grip" title="Arraste para reordenar">⋮⋮</span>
              <span className="num">
                {t.id === p.currentId ? (p.playing ? "▶" : "⏸") : String(i + 1).padStart(2, "0")}
              </span>
              <span className="name">{t.name}</span>
              <button
                className="x"
                title="Remover"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(t.id);
                }}
              >
                ✕
              </button>
            </li>
          ))}
          {!tracks.length && <li className="empty">Nenhuma música ainda.</li>}
        </ul>
      </section>

      <section className="card settings">
        <h2>Ajustes</h2>

        <div className="row">
          <span className="label">Loop</span>
          <div className="seg">
            {loops.map(([m, label]) => (
              <button
                key={m}
                className={loop === m ? "on" : ""}
                onClick={() => {
                  p.loop = m;
                  setLoop(m);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="row">
          <span className="label">Transição</span>
          <div className="seg">
            {TRANSITIONS.map((t) => (
              <button
                key={t.id}
                className={transition === t.id ? "on" : ""}
                title={t.hint}
                onClick={() => {
                  p.transition = t.id;
                  setTransition(t.id);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <p className="hint">{hint}</p>

        <label className="slider">
          <span>Duração da transição: {fade}s</span>
          <input
            type="range"
            min={0}
            max={10}
            step={0.5}
            value={fade}
            style={{ ["--pct" as string]: `${fade * 10}%` }}
            onChange={(e) => {
              const v = Number(e.target.value);
              p.fadeMs = v * 1000;
              setFade(v);
            }}
          />
        </label>
        <label className="slider">
          <span>Fade ao pausar/retomar: {pauseFade}s</span>
          <input
            type="range"
            min={0}
            max={5}
            step={0.5}
            value={pauseFade}
            style={{ ["--pct" as string]: `${pauseFade * 20}%` }}
            onChange={(e) => {
              const v = Number(e.target.value);
              p.pauseFadeMs = v * 1000;
              setPauseFade(v);
            }}
          />
        </label>
        <label className="slider">
          <span>Volume: {Math.round(volume * 100)}%</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            style={{ ["--pct" as string]: `${volume * 100}%` }}
            onChange={(e) => {
              const v = Number(e.target.value);
              p.setVolume(v);
              setVolume(v);
            }}
          />
        </label>
      </section>
    </main>
  );
}
