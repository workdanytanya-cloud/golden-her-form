import { createFileRoute } from "@tanstack/react-router";
import { Nav } from "@/components/landing/Nav";
import { Hero } from "@/components/landing/Hero";
import { Results } from "@/components/landing/Results";
import { Programs } from "@/components/landing/Programs";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Testimonials } from "@/components/landing/Testimonials";
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
          "Персональные программы похудения от Татьяны Пановой. 15+ лет опыта, 10 000+ подопечных. Стройное тело и уверенность в зеркале.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <Nav />
      <Hero />
      <Results />
      <Programs />
      <HowItWorks />
      <Testimonials />
      <Faq />
      <CtaFinal />
      <Footer />
    </main>
  );
}
