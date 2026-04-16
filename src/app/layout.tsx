import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Figma → Sitecore | Kajoo AI",
  description: "Convert Figma designs into Sitecore component code using AI",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
