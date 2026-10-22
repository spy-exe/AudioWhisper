import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 px-6 py-20 text-center">
      <p className="font-mono text-sm text-accent">404</p>
      <h1 className="font-[var(--font-display)] text-2xl font-semibold">Esta página não existe</h1>
      <p className="text-text-secondary">O endereço pode ter mudado ou a gravação foi excluída.</p>
      <div className="flex flex-wrap justify-center gap-4 text-sm">
        <Link href="/library" className="text-accent hover:underline">
          Abrir a biblioteca
        </Link>
        <Link href="/" className="text-text-secondary hover:text-accent">
          Voltar ao Studio
        </Link>
      </div>
    </div>
  );
}
