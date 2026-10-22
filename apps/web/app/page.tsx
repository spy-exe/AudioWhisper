import { HomeHero } from "@/components/home/HomeHero";
import { RecentJobsList } from "@/components/jobs/RecentJobsList";
import { UploadDropzone } from "@/components/upload/UploadDropzone";
import Link from "next/link";

export default function HomePage() {
  return (
    <div className="studio-page">
      <HomeHero />
      <section className="studio-workspace-link"><div><h2>Da conversa ao próximo passo.</h2><p>Projetos, tarefas e conhecimento conectados ao seu áudio.</p></div><Link href="/workspace" className="hub-text-link">Abrir minha central →</Link></section>
      <div className="studio-ingest-grid">
      <div id="live-capture-slot" />
      <section id="importar" aria-label="Importar gravação" className="import-card studio-panel">
        <div className="ingest-title"><h2>Importar gravação</h2><p>Seu próximo insight pode estar em um arquivo.</p></div>
        <UploadDropzone />
      </section>
      </div>
      <section className="recent-section">
        <div className="section-heading"><div><h2>Sua atividade recente</h2><p>Retome uma conversa. Encontre uma nova perspectiva.</p></div></div>
        <RecentJobsList />
      </section>
    </div>
  );
}
