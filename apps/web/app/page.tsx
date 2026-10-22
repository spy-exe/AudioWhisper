import { HomeHero } from "@/components/home/HomeHero";
import { RecentJobsList } from "@/components/jobs/RecentJobsList";
import { UploadDropzone } from "@/components/upload/UploadDropzone";

export default function HomePage() {
  return (
    <div className="studio-page">
      <HomeHero />
      <div className="studio-ingest-grid">
        <div id="live-capture-slot" />
        <section
          id="importar"
          aria-label="Importar gravação"
          className="import-card studio-panel"
        >
          <div className="ingest-title">
            <h2>Importar gravação</h2>
          </div>
          <UploadDropzone />
        </section>
      </div>
      <section className="recent-section">
        <div className="section-heading">
          <div>
            <h2>Gravações recentes</h2>
          </div>
        </div>
        <RecentJobsList />
      </section>
    </div>
  );
}
