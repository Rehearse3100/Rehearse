/**
 * DataRoomChatAnswer.tsx
 * The body of one AI Research Assistant reply in the Data Room chat pane
 * (ProspectingDataRoomChat): the intro line, then the companies as text blocks
 * (the default, and every reply saved before tables existed), a result table (an
 * All-companies filter list, layout "table") or a side-by-side compare table (layout
 * "compare"). Tables only use the card values the server sends with each item
 * (lib/data-room-chat-scope.ts AnswerCard); a reply without them falls back to the
 * text blocks. Also the "Search all companies" pill offered under a filter question
 * about one company. Design: Stitch chat pane components 2–4.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import type { AnswerCard, AnswerLayout, ScopedAnswerItem } from "@/lib/data-room-chat-scope";

/** A result table with this many rows or more scrolls inside the reply (sticky header). */
export const TABLE_SCROLL_FROM_ROWS = 11;

// Compare columns, as in the Stitch design: a fixed label column and one per company.
const COMPARE_LABEL_COLUMN_PX = 110;
const COMPARE_COMPANY_COLUMN_PX = 145;

/** What a reply body needs: the intro, the companies and how to lay them out. */
export type ChatAnswer = {
  intro: string;
  items: readonly ScopedAnswerItem[];
  layout?: AnswerLayout;
  isError?: boolean;
};

/**
 * How a reply is shown: "table" or "compare" only when the server asked for it and
 * every company has its card values (compare also needs two or more); anything else,
 * including every reply saved before tables existed, is "list".
 */
export function answerLayoutOf(answer: ChatAnswer): AnswerLayout {
  const hasCards = answer.items.length > 0 && answer.items.every((item) => item.card !== undefined);
  if (answer.isError || !hasCards) {
    return "list";
  }
  if (answer.layout === "table") {
    return "table";
  }
  return answer.layout === "compare" && answer.items.length >= 2 ? "compare" : "list";
}

const MISSING = "—";

function territoryLabel(card: AnswerCard): string | null {
  return card.inTerritory === null ? null : card.inTerritory ? "In territory" : "Out of territory";
}

function bookingLabel(card: AnswerCard): string | null {
  return card.onlineBooking === null ? null : card.onlineBooking ? "Online booking" : "No online booking";
}

// ── Result table (Stitch component 3) ───

const HEADER_CELL =
  "py-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant bg-surface shadow-[inset_0_-1px_0_theme(colors.outline-variant)]";

/**
 * An All-companies filter list as a table: Company (name, territory and booking
 * tags) | Industry | Loc | City. Up to 10 rows at full height; 11 or more scroll
 * inside the reply (about 320px) with the header kept in view.
 */
export function ResultTable({ items }: { items: readonly ScopedAnswerItem[] }): React.ReactElement {
  const isScrolling = items.length >= TABLE_SCROLL_FROM_ROWS;
  return (
    <div className="border border-outline-variant rounded-lg overflow-hidden bg-white">
      <div
        data-scrolls={isScrolling ? "true" : "false"}
        className={`overflow-x-auto custom-scrollbar ${isScrolling ? "max-h-[320px] overflow-y-auto" : ""}`}
      >
        <table className="w-full text-left border-collapse">
          <thead className={isScrolling ? "sticky top-0 z-10" : undefined}>
            <tr>
              <th scope="col" className={HEADER_CELL}>
                Company
              </th>
              <th scope="col" className={HEADER_CELL}>
                Industry
              </th>
              <th scope="col" className={`${HEADER_CELL} text-center`}>
                Loc
              </th>
              <th scope="col" className={HEADER_CELL}>
                City
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant">
            {items.map((item) => {
              const card = item.card;
              const tags = card ? [territoryLabel(card), bookingLabel(card)].filter((tag): tag is string => tag !== null) : [];
              return (
                <tr key={item.companyId} className="hover:bg-surface/60 transition-colors motion-reduce:transition-none">
                  <td className="py-2 px-2 align-top">
                    <div className="text-[12px] font-medium text-on-surface leading-snug">{item.companyName}</div>
                    {tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {tags.map((tag) => (
                          <span
                            key={tag}
                            className="inline-block px-1.5 rounded-full text-[11px] leading-[18px] bg-surface-container-low text-on-surface-variant border border-outline-variant/60"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-2 px-2 text-[12px] text-on-surface-variant align-top">{card?.industry || MISSING}</td>
                  <td className="py-2 px-2 text-[12px] text-on-surface font-mono text-center align-top">
                    {card?.locations ?? MISSING}
                  </td>
                  <td className="py-2 px-2 text-[12px] text-on-surface-variant align-top">{card?.metro || MISSING}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Compare table (Stitch component 4) ───

/** True while the element is wider inside than it shows (measured after render; false before). */
function useHorizontalOverflow(ref: React.RefObject<HTMLElement>): boolean {
  const [isOverflowing, setIsOverflowing] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    // 1px of slack so rounding never shows the hint on a table that fits.
    const measure = (): void => setIsOverflowing(element.scrollWidth > element.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return isOverflowing;
}

type CompareRow = { label: string; isMono?: boolean; value: (item: ScopedAnswerItem, card: AnswerCard) => React.ReactNode };

const COMPARE_ROWS: readonly CompareRow[] = [
  { label: "Industry", value: (_item, card) => card.industry || MISSING },
  { label: "Locations", isMono: true, value: (_item, card) => card.locations ?? MISSING },
  { label: "City", value: (_item, card) => card.metro || MISSING },
  { label: "Territory", value: (_item, card) => territoryLabel(card) ?? MISSING },
  {
    label: "Online booking",
    value: (_item, card) => (card.onlineBooking === null ? MISSING : card.onlineBooking ? "Yes" : "No"),
  },
  {
    label: "Signals",
    value: (item) =>
      item.signals && item.signals.length > 0 ? (
        <ul className="space-y-1.5">
          {item.signals.map((signal, i) => (
            <li key={i} className="flex items-start gap-1.5 leading-snug">
              <span aria-hidden="true" className="text-on-surface-variant text-[11px] font-bold mt-0.5">
                •
              </span>
              <span className="text-[12px] text-on-surface">{signal}</span>
            </li>
          ))}
        </ul>
      ) : (
        MISSING
      ),
  },
];

/**
 * Two or three companies side by side: a label column on the left (Industry,
 * Locations, City, Territory, Online booking, Signals) and one column per company.
 * Wider than the reply → it scrolls sideways with the label column fixed, and the
 * hint "← Scroll horizontally to compare columns" shows (only then).
 */
export function CompareTable({ items }: { items: readonly ScopedAnswerItem[] }): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isOverflowing = useHorizontalOverflow(scrollRef);
  const minWidth = COMPARE_LABEL_COLUMN_PX + COMPARE_COMPANY_COLUMN_PX * items.length;
  return (
    <div className="space-y-1">
      <div className="border border-outline-variant rounded-lg overflow-hidden bg-white">
        <div ref={scrollRef} className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left border-collapse" style={{ minWidth }}>
            <thead>
              <tr className="border-b border-outline-variant bg-surface">
                <th
                  scope="col"
                  className="sticky left-0 z-20 bg-surface py-2 px-2.5 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant border-r border-outline-variant"
                  style={{ width: COMPARE_LABEL_COLUMN_PX, minWidth: COMPARE_LABEL_COLUMN_PX }}
                >
                  Attribute
                </th>
                {items.map((item, i) => (
                  <th
                    key={item.companyId}
                    scope="col"
                    className={`py-2 px-3 text-[12px] font-bold leading-tight text-primary-container align-top bg-white ${
                      i < items.length - 1 ? "border-r border-outline-variant" : ""
                    }`}
                    style={{ width: COMPARE_COMPANY_COLUMN_PX, minWidth: COMPARE_COMPANY_COLUMN_PX }}
                  >
                    {item.companyName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant text-[12px]">
              {COMPARE_ROWS.map((row) => (
                <tr key={row.label}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-surface py-1.5 px-2.5 text-[11px] font-semibold text-on-surface-variant border-r border-outline-variant align-top"
                  >
                    {row.label}
                  </th>
                  {items.map((item, i) => (
                    <td
                      key={item.companyId}
                      className={`py-1.5 px-3 text-on-surface bg-white align-top ${row.isMono ? "font-mono" : ""} ${
                        i < items.length - 1 ? "border-r border-outline-variant" : ""
                      }`}
                    >
                      {item.card ? row.value(item, item.card) : MISSING}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {isOverflowing ? (
        <p className="px-1 pt-1 text-[11px] text-on-surface-variant">← Scroll horizontally to compare columns</p>
      ) : null}
    </div>
  );
}

// ── The reply body ───

/**
 * One reply's body: the intro, then the companies as text blocks (exactly as before
 * tables existed), a result table or a compare table (answerLayoutOf). Rendered
 * inside the reply bubble, whose spacing separates the parts.
 */
export function DataRoomChatAnswer({ answer }: { answer: ChatAnswer }): React.ReactElement {
  const layout = answerLayoutOf(answer);
  return (
    <>
      {answer.intro ? (
        <p
          className={
            layout === "table"
              ? "text-[13px] font-medium text-on-surface whitespace-pre-wrap"
              : `whitespace-pre-wrap ${answer.isError ? "text-error" : "text-on-surface-variant"}`
          }
        >
          {answer.intro}
        </p>
      ) : null}
      {layout === "table" ? <ResultTable items={answer.items} /> : null}
      {layout === "compare" ? <CompareTable items={answer.items} /> : null}
      {layout === "list"
        ? answer.items.map((item) => (
            <div key={item.companyId}>
              <p className="text-[12px] font-semibold text-on-surface mb-1">{item.companyName}</p>
              <p className="text-on-surface-variant whitespace-pre-wrap">{item.text}</p>
            </div>
          ))
        : null}
    </>
  );
}

// ── "Search all companies" (Stitch component 2) ───

/** The pill under a filter question about one company: asks the same question about every company. */
export function SearchAllCompaniesButton({ onClick }: { onClick: () => void }): React.ReactElement {
  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        className="group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-outline-variant bg-white hover:border-primary-container hover:bg-surface text-[12px] font-medium text-on-surface transition-all motion-reduce:transition-none shadow-[0_1px_2px_rgba(0,0,0,0.02)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-1"
      >
        <span>Search all companies</span>
        <MaterialIcon
          name="arrow_forward"
          className="text-[14px] text-on-surface-variant group-hover:text-primary-container group-hover:translate-x-0.5 transition-transform motion-reduce:transition-none"
        />
      </button>
    </div>
  );
}
