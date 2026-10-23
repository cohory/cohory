import { getPlatformConfig } from "@cohory/config/platform";
import { ImageResponse } from "next/og";
import { connection } from "next/server";

export const alt = "Community platform";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const colors = {
  /* eslint-disable no-restricted-syntax -- Satori cannot read CSS variables, so these copy the light tokens from tokens.css */
  bg: "#F8FAFC",
  text: "#111827",
  muted: "#64748B",
  accent: "#2563EB",
  accentForeground: "#FFFFFF",
  /* eslint-enable no-restricted-syntax */
};

export default async function OpenGraphImage() {
  await connection();
  const { name } = getPlatformConfig().instance;
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 32,
        padding: 96,
        background: colors.bg,
      }}
    >
      <div
        style={{
          width: 96,
          height: 96,
          borderRadius: 24,
          background: colors.accent,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            border: `9px solid ${colors.accentForeground}`,
          }}
        />
      </div>
      <div style={{ fontSize: 80, fontWeight: 700, color: colors.text }}>{name}</div>
      <div style={{ fontSize: 36, color: colors.muted }}>Communities, courses, and events</div>
    </div>,
    size,
  );
}
