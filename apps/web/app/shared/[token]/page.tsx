import { SharedDocument } from "./shared-document";
export const metadata = {
  title: "Documento compartilhado · AudioWhisper",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function SharedPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <SharedDocument token={token} />;
}
