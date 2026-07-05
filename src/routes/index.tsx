import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/landing/Nav";
import { Hero } from "@/components/landing/Hero";
import { About } from "@/components/landing/About";
import { WhyChoose } from "@/components/landing/WhyChoose";
import { Programs } from "@/components/landing/Programs";
import { Results } from "@/components/landing/Results";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Faq } from "@/components/landing/Faq";
import { CtaFinal } from "@/components/landing/CtaFinal";
import { Footer } from "@/components/landing/Footer";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PanovaPRO — Татьяна Панова · Персональный фитнес-коучинг" },
      {
        name: "description",
        content:
          "Авторская система похудения от Татьяны Пановой. 15+ лет тренерства, 10 000+ подопечных. Без срывов и голодовок.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <Nav />
      <Hero />
      <About />
      <WhyChoose />
      <Programs />
      <Results />
      <HowItWorks />
      <Faq />
      <CtaFinal />
      <Footer />
    </main>
  );
}
