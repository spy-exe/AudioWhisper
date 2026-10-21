import type { SVGProps } from "react";

const paths = {
  studio: "M3 10v4m4-8v12m5-16v20m5-16v12m4-8v4",
  library: "M4 4h4v16H4zM10 4h4v16h-4zM17 4l4 1-3 15-4-1z",
  settings: "M4 7h16M4 17h16M8 4v6m8 4v6",
  mic: "M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0zM6 10v2a6 6 0 0 0 12 0v-2M12 18v4m-4 0h8",
  upload: "M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  file: "M14 3H5v18h14V8zm0 0v5h5M8 12h8m-8 4h6",
  sparkle: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z",
  search: "M15.5 15.5 21 21M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6zm-4 9 3 3 5-6",
};
export function Icon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { name: keyof typeof paths }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
