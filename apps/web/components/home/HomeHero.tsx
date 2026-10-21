import { Icon } from "@/components/ui/Icon";

const ribbons = Array.from({ length: 22 }, (_, index) => {
  const points = Array.from({ length: 121 }, (_, point) => {
    const x = point * 5;
    const envelope = Math.sin((x / 600) * Math.PI) ** 1.3;
    const y = 154 + Math.sin(x / 58 + index * 0.14) * envelope * (54 + index * 2.1)
      + Math.cos(x / 31 - index * 0.11) * envelope * 24;
    return `${point ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return points.join(" ");
});

export function HomeHero() {
  return (
    <section className="studio-welcome">
      <div className="welcome-copy">
        <p className="eyebrow"><span className="eyebrow-dot" /> SEU ESTÚDIO DE ÁUDIO</p>
        <h1>Dê forma ao que<br /><span>você ouve.</span></h1>
        <p className="welcome-description">Grave, transcreva e transforme conversas em decisões. Tudo no seu computador.</p>
        <div className="welcome-workflow" aria-label="Etapas do Studio">
          <span><Icon name="mic" /> Gravar</span><span className="workflow-connector" />
          <span><Icon name="file" /> Transcrever</span><span className="workflow-connector" />
          <span><Icon name="sparkle" /> Criar</span>
        </div>
      </div>
      <div className="signal-art" aria-hidden="true">
        <div className="signal-grid" />
        <div className="signal-orbit orbit-one" /><div className="signal-orbit orbit-two" />
        <svg viewBox="0 0 600 320" className="signal-ribbon" data-ambient="signal">
          <defs>
            <linearGradient id="ribbon-ink" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#9bc7ff" stopOpacity="0" />
              <stop offset=".25" stopColor="#9bc7ff" />
              <stop offset=".6" stopColor="#c4b5fd" />
              <stop offset=".82" stopColor="#ffbd87" />
              <stop offset="1" stopColor="#ffbd87" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g className="signal-motion">
            {ribbons.map((path, index) => <path key={index} d={path} fill="none" stroke="url(#ribbon-ink)" strokeWidth={index % 5 === 0 ? 1.6 : 0.8} opacity={0.3 + index / 38} />)}
          </g>
        </svg>
        <div className="signal-caption"><span className="signal-line" /> ÁUDIO EM FOCO. IDEIAS EM MOVIMENTO.</div>
      </div>
    </section>
  );
}
