/**
 * TempoEntryFreshStart.tsx
 * Fresh-start briefing layout for the Tempo / Summit Dental simulation entry page.
 * Structural reference: Stitch "Simulation Entry - Fresh Start" (hero through footer).
 */

import Link from "next/link";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { COLORS } from "@/lib/design-tokens";
import { TEMPO_STAGES } from "@/lib/tempo-simulation";

type TempoEntryFreshStartProps = {
  classId: string;
  ctaHref: string;
};

const FRESH_TIMELINE_STAGES = [
  { icon: "search", modality: "Written", title: "Prospecting", desc: "Craft a cold outreach sequence.", time: "10 MIN" },
  { icon: "forum", modality: "Live Call", title: "Discovery", desc: "Uncover your prospect's true pain points.", time: "15 MIN" },
  { icon: "present_to_all", modality: "Structured", title: "Presentation", desc: "Deliver the value proposition.", time: "12 MIN" },
  { icon: "shield", modality: "Live Call", title: "Objections", desc: "Handle technical pushback.", time: "10 MIN" },
  { icon: "handshake", modality: "Negotiation", title: "The Close", desc: "Lock in the annual contract.", time: "15 MIN" },
] as const;

/**
 * Renders the Tempo simulation entry page for students with no active progress.
 */
export function TempoEntryFreshStart({
  classId,
  ctaHref,
}: TempoEntryFreshStartProps): React.ReactElement {
  return (
    <div className="animate-fade-in-up -mx-0 min-h-full bg-primary-container">
      {/* HERO SECTION */}
      <section className="bg-primary-container text-white py-16">
        <div className="max-w-[1100px] mx-auto px-6 lg:px-8 mb-8">
          <Link
            href={`/student/classes/${classId}`}
            className="inline-flex items-center gap-2 text-white/50 hover:text-white transition-colors text-sm"
          >
            <MaterialIcon name="arrow_back" className="text-[18px]" />
            Back
          </Link>
        </div>
        <div className="max-w-[1100px] mx-auto px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-7">
            <div className="inline-block px-3 py-1 rounded bg-tertiary-fixed text-on-tertiary-fixed font-code-md text-[11px] font-bold mb-4">
              NEW SIMULATION
            </div>
            <h1 className="text-[48px] leading-[56px] font-bold tracking-tight mb-4">
              Sell Tempo to <br />
              <span className="text-tertiary-fixed">Your Target Account</span>
            </h1>
            <p className="text-body-lg text-white/60 mb-8 max-w-xl">
              Somewhere in your prospect directory, one account is struggling with operational
              inefficiencies. Your goal is to find it and guide its decision maker through a full
              sales cycle, from prospecting to close.
            </p>
            <div className="flex flex-wrap gap-3">
              {[
                { icon: "location_on", text: "Mountain West territory" },
                { icon: "corporate_fare", text: "25 candidate accounts" },
                { icon: "schedule", text: "~60 minutes total" },
              ].map((pill) => (
                <div
                  key={pill.text}
                  className="px-4 py-2 bg-white/10 rounded-full flex items-center gap-2 text-body-md"
                >
                  <MaterialIcon name={pill.icon} className="text-white/70" />
                  <span>{pill.text}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="lg:col-span-5">
            <div
              className="border border-white/10 rounded-xl p-6 font-code-md shadow-2xl"
              style={{ backgroundColor: COLORS.crmCardDepth }}
            >
              <div className="flex justify-between items-center mb-6">
                <span className="text-white/40 text-[12px]">CRM // ACCOUNT_DETAILS</span>
                <MaterialIcon name="dataset" className="text-white/40" />
              </div>
              <div className="space-y-4 mb-8">
                <div>
                  <div className="text-white/40 text-[11px] mb-1">INDUSTRY</div>
                  <div className="text-white">Appointment-based services</div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-white/40 text-[11px] mb-1">ACCOUNT</div>
                    <div className="text-white">To be identified</div>
                  </div>
                  <div>
                    <div className="text-white/40 text-[11px] mb-1">REGION</div>
                    <div className="text-white">Mountain West</div>
                  </div>
                </div>
              </div>
              <div className="pt-6 border-t border-white/10">
                <div className="text-white/40 text-[11px] mb-3">YOUR CONTACT</div>
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <div className="w-12 h-12 rounded-lg bg-surface-container-highest overflow-hidden flex items-center justify-center">
                      <MaterialIcon name="person" className="text-white/60" />
                    </div>
                    <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-[#0f172a] animate-pulse" />
                  </div>
                  <div>
                    <div className="text-white font-bold">Not yet identified</div>
                    <div className="text-white/50 text-[13px]">Find who owns this decision</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ASSIGNMENT & PRODUCT */}
      <section className="bg-white py-20">
        <div className="max-w-[1100px] mx-auto px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
            <div>
              <div className="text-secondary font-bold tracking-widest text-[12px] mb-4">YOUR ASSIGNMENT</div>
              <h2 className="text-headline-lg font-bold mb-6">
                One account. Five stages. <br />
                One deal.
              </h2>
              <div className="space-y-4 text-on-surface-variant text-body-lg">
                <p>
                  You are a Senior Account Executive at Tempo, the leading automation platform for
                  appointment-based practices. Your mission is to find the right account in your
                  territory and land it as a regional anchor client.
                </p>
                <p>
                  One decision maker at that account owns this purchase. They care about operational
                  excellence but are underwater on day-to-day scheduling problems. Identifying the
                  account and that person is your first job.
                </p>
              </div>
            </div>
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-8 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-4 opacity-5">
                <MaterialIcon name="inventory_2" className="text-[120px]" />
              </div>
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center">
                  <MaterialIcon name="bolt" className="text-white" />
                </div>
                <span className="font-bold text-headline-md text-on-surface">Tempo - Your Product</span>
              </div>
              <div className="bg-tertiary-fixed/20 border-l-4 border-tertiary-fixed p-4 mb-8 italic text-on-surface-variant">
                &quot;Tempo is the nervous system for the modern practice. We automate the
                admin, so doctors can focus on patients.&quot;
              </div>
              <div className="grid grid-cols-2 gap-y-6 gap-x-4">
                {[
                  { icon: "event_busy", title: "Cut no-shows", detail: "Smart SMS reminders" },
                  { icon: "support_agent", title: "Free the front desk", detail: "Automated intake" },
                  { icon: "history_toggle_off", title: "After-hours demand", detail: "24/7 AI scheduling" },
                  { icon: "group_add", title: "Drive repeat visits", detail: "Retention marketing" },
                ].map((item) => (
                  <div key={item.title} className="flex items-start gap-3">
                    <MaterialIcon name={item.icon} className="text-secondary text-[20px]" />
                    <div>
                      <div className="font-bold text-[13px]">{item.title}</div>
                      <div className="text-[12px] text-on-surface-variant">{item.detail}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TIMELINE SECTION */}
      <section className="bg-surface-container-low py-20 overflow-hidden">
        <div className="max-w-[1100px] mx-auto px-6 lg:px-8">
          <div className="text-center mb-16">
            <div className="text-tertiary-container font-bold tracking-widest text-[12px] mb-4 uppercase">
              What you&apos;ll do
            </div>
            <h2 className="text-headline-lg font-bold">The Sales Lifecycle</h2>
          </div>
          <div className="relative">
            <div className="absolute top-6 left-0 right-0 h-0.5 bg-outline-variant z-0 hidden md:block" />
            <div className="grid grid-cols-1 md:grid-cols-5 gap-6 relative z-10">
              {FRESH_TIMELINE_STAGES.map((stage, index) => (
                <div key={stage.title} className="space-y-4 group">
                  <div className="w-12 h-12 rounded-full bg-outline-variant text-on-surface-variant flex items-center justify-center border-4 border-white relative">
                    <MaterialIcon name={stage.icon} />
                    <div className="absolute -top-1 -right-1 w-5 h-5 bg-primary-container text-white text-[10px] flex items-center justify-center rounded-full font-bold border-2 border-white">
                      {index + 1}
                    </div>
                  </div>
                  <div
                    className={`bg-white p-5 rounded-xl border border-outline-variant transition-opacity ${
                      index === 0 ? "opacity-70 group-hover:opacity-100" : "opacity-50"
                    }`}
                  >
                    <div className="inline-block px-2 py-0.5 rounded bg-surface-container-highest text-on-surface-variant text-[10px] font-bold uppercase mb-2">
                      {stage.modality}
                    </div>
                    <div className="font-bold text-body-md mb-1">{stage.title}</div>
                    <p className="text-[12px] text-on-surface-variant mb-3">{stage.desc}</p>
                    <div className="text-[11px] font-code-md text-on-surface-variant">{stage.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* SCORING & RULES */}
      <section className="bg-white py-20">
        <div className="max-w-[1100px] mx-auto px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 mb-20">
            <div>
              <h3 className="text-headline-md font-bold mb-6">How you&apos;re scored</h3>
              <div className="space-y-6">
                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded bg-primary-container/10 flex items-center justify-center shrink-0">
                    <MaterialIcon name="psychology" className="text-primary" />
                  </div>
                  <div>
                    <div className="font-bold text-body-lg">Substance</div>
                    <p className="text-on-surface-variant">
                      Did you follow the playbook? Did you address the client&apos;s specific dental
                      industry concerns?
                    </p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="w-10 h-10 rounded bg-tertiary-fixed/30 flex items-center justify-center shrink-0">
                    <MaterialIcon name="record_voice_over" className="text-tertiary-container" />
                  </div>
                  <div>
                    <div className="font-bold text-body-lg">Style</div>
                    <p className="text-on-surface-variant">
                      How professional was your tone? Did you show empathy and authority in your
                      vocal delivery?
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="bg-surface-container rounded-xl p-8">
              <div className="text-[12px] font-bold text-on-surface-variant mb-4 uppercase">
                UNLOCKABLE BADGES
              </div>
              <div className="flex flex-wrap gap-4">
                {["stars", "rocket_launch", "emoji_events", "verified"].map((icon) => (
                  <div
                    key={icon}
                    className="w-16 h-16 rounded-full bg-white border-2 border-dashed border-outline-variant flex items-center justify-center opacity-40 grayscale"
                  >
                    <MaterialIcon name={icon} />
                  </div>
                ))}
              </div>
              <p className="mt-6 text-[12px] text-on-surface-variant">
                Complete stages with high scores to earn permanent profile achievements.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: "smart_toy",
                title: "AI Preparation",
                body: "Our AI plays your buyer and remembers what you say across all 5 stages.",
              },
              {
                icon: "volume_off",
                title: "Live calls alone",
                body: "Ensure you are in a quiet space. Headsets are recommended for voice stages.",
              },
              {
                icon: "replay",
                title: "Infinite retries",
                body: "You can restart any stage at any time until you achieve your goal score.",
              },
            ].map((rule) => (
              <div key={rule.title} className="p-6 border border-outline-variant rounded-xl">
                <MaterialIcon name={rule.icon} className="text-secondary mb-4" />
                <div className="font-bold mb-2">{rule.title}</div>
                <p className="text-[13px] text-on-surface-variant">{rule.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA SECTION */}
      <section className="bg-primary-container text-white py-24 text-center relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 pointer-events-none">
          <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-secondary via-transparent to-transparent" />
        </div>
        <div className="max-w-[1100px] mx-auto px-6 lg:px-8 relative z-10">
          <h2 className="text-headline-lg font-bold mb-4">Ready to start?</h2>
          <p className="text-white/60 mb-10 max-w-lg mx-auto">
            Stage 1: {TEMPO_STAGES[0]?.title ?? "Prospecting"} takes about 15 minutes. <br />
            Your progress will be saved automatically.
          </p>
          <Link
            href={ctaHref}
            className="inline-flex items-center gap-3 bg-tertiary-fixed text-on-tertiary-fixed hover:opacity-90 transition-all px-10 py-5 rounded-full font-bold text-headline-md shadow-xl hover:scale-105 active:scale-95 group"
          >
            Begin Simulation
            <MaterialIcon name="arrow_forward" className="group-hover:translate-x-1 transition-transform" />
          </Link>
          <div className="mt-8 text-white/40 text-body-md">Estimated total time: ~60 minutes</div>
        </div>
      </section>

    </div>
  );
}
