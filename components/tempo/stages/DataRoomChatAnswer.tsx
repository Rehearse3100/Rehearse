/**
 * DataRoomChatAnswer.tsx
 * The body of one AI Research Assistant reply in the Data Room chat pane
 * (ProspectingDataRoomChat): the intro line, then the companies as text blocks
 * (the default, and every reply saved before tables existed), a result table (an
 * All-companies filter list, layout "table") or a side-by-side compare table (layout
 * "compare"), then the reply's note, if any, in small muted text. In a text block, a
 * company whose lines carry their sources shows a small "Research" tag before each
 * research finding and "Public" before each public signal (card facts get none); a
 * block without sources, or with card facts only, shows its text as before. Tables
 * only use the card values the server sends with each item
 * (lib/data-room-chat-scope.ts AnswerCard); a reply without them falls back to the
 * text blocks. Every company name (the table's Company cell, each compare column
 * header, each text block's heading) is a button that opens that company, as a click
 * in the left company list does, when the pane passes onOpenCompany and the company
 * is in its current list (openableCompanyIds); otherwise the name is plain text,
 * exactly as before. Also the "Search all companies" pill offered under a filter
 * question about one company. Column, row and tag labels come from the simulation's
 * chat config (lib/data-room-chat-config.ts). Design: Stitch chat pane components 2–4.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { getDataRoomChatConfig, type DataRoomChatConfig } from "@/lib/data-room-chat-config";
import type { AnswerCard, AnswerLayout, AnswerLine, CompareRowKey, ScopedAnswerItem } from "@/lib/data-room-chat-scope";

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
  /** A compare limited to some details: only these rows (missing or empty → every row). */
  compareRows?: readonly CompareRowKey[];
  /** One fixed line under the answer (small, muted); missing on most replies. */
  note?: string;
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

// ── Company names that open the company ───

/** What a reply needs to open a company from its name: the opener and the companies it can open. */
export type CompanyOpenProps = {
  /** Opens the company in the middle screen (the left list's click); omitted → names stay plain text. */
  onOpenCompany?: (companyId: string) => void;
  /** The companies in the pane's current list; a name is a button only when its id is here. */
  openableCompanyIds?: ReadonlySet<string>;
};

/**
 * One company's name in a reply: a button that opens the company (same size and
 * weight as the text around it; primary colour and an underline on hover, a focus
 * ring for the keyboard) when it can be opened, otherwise the plain name exactly as
 * before (an old saved chat's company that is no longer in the list, or a reply
 * shown without onOpenCompany).
 */
export function CompanyName({
  item,
  onOpenCompany,
  openableCompanyIds,
}: CompanyOpenProps & { item: Pick<ScopedAnswerItem, "companyId" | "companyName"> }): React.ReactElement {
  if (!onOpenCompany || !openableCompanyIds?.has(item.companyId)) {
    return <>{item.companyName}</>;
  }
  return (
    <button
      type="button"
      onClick={() => onOpenCompany(item.companyId)}
      aria-label={`Open ${item.companyName}`}
      className="text-left cursor-pointer rounded-sm hover:text-primary hover:underline underline-offset-2 transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-1"
    >
      {item.companyName}
    </button>
  );
}

type CardLabels = DataRoomChatConfig["cardLabels"];

function territoryLabel(card: AnswerCard, labels: CardLabels): string | null {
  return card.inTerritory === null ? null : card.inTerritory ? labels.inTerritory : labels.outOfTerritory;
}

function bookingLabel(card: AnswerCard, labels: CardLabels): string | null {
  return card.onlineBooking === null ? null : card.onlineBooking ? labels.onlineBooking : labels.noOnlineBooking;
}

// ── Result table (Stitch component 3) ───

const HEADER_CELL =
  "py-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant bg-surface shadow-[inset_0_-1px_0_theme(colors.outline-variant)]";

/**
 * An All-companies filter list as a table: Company (name, territory and booking
 * tags) | Industry | Loc | City. Up to 10 rows at full height; 11 or more scroll
 * inside the reply (about 320px) with the header kept in view.
 */
export function ResultTable({
  items,
  config = getDataRoomChatConfig(),
  onOpenCompany,
  openableCompanyIds,
}: CompanyOpenProps & {
  items: readonly ScopedAnswerItem[];
  /** The simulation's labels (lib/data-room-chat-config.ts); Tempo's by default. */
  config?: DataRoomChatConfig;
}): React.ReactElement {
  const isScrolling = items.length >= TABLE_SCROLL_FROM_ROWS;
  const headers = config.tableHeaders;
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
                {headers.company}
              </th>
              <th scope="col" className={HEADER_CELL}>
                {headers.industry}
              </th>
              <th scope="col" className={`${HEADER_CELL} text-center`}>
                {headers.locations}
              </th>
              <th scope="col" className={HEADER_CELL}>
                {headers.city}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant">
            {items.map((item) => {
              const card = item.card;
              const tags = card
                ? [territoryLabel(card, config.cardLabels), bookingLabel(card, config.cardLabels)].filter(
                    (tag): tag is string => tag !== null
                  )
                : [];
              return (
                <tr key={item.companyId} className="hover:bg-surface/60 transition-colors motion-reduce:transition-none">
                  <td className="py-2 px-2 align-top">
                    <div className="text-[12px] font-medium text-on-surface leading-snug">
                      <CompanyName item={item} onOpenCompany={onOpenCompany} openableCompanyIds={openableCompanyIds} />
                    </div>
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

/** One compare row: its key (its label comes from the config's compareRowLabels) and its cell. */
type CompareRow = {
  key: CompareRowKey;
  isMono?: boolean;
  value: (item: ScopedAnswerItem, card: AnswerCard, labels: CardLabels) => React.ReactNode;
};

const COMPARE_ROWS: readonly CompareRow[] = [
  { key: "industry", value: (_item, card) => card.industry || MISSING },
  { key: "locations", isMono: true, value: (_item, card) => card.locations ?? MISSING },
  { key: "city", value: (_item, card) => card.metro || MISSING },
  { key: "territory", value: (_item, card, labels) => territoryLabel(card, labels) ?? MISSING },
  {
    key: "online_booking",
    value: (_item, card) => (card.onlineBooking === null ? MISSING : card.onlineBooking ? "Yes" : "No"),
  },
  {
    key: "signals",
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
 * Locations, City, Territory, Online booking, Signals; only the rows asked for when
 * the question named some) and one column per company.
 * Wider than the reply → it scrolls sideways with the label column fixed, and the
 * hint "← Scroll horizontally to compare columns" shows (only then).
 */
export function CompareTable({
  items,
  rows = [],
  config = getDataRoomChatConfig(),
  onOpenCompany,
  openableCompanyIds,
}: CompanyOpenProps & {
  items: readonly ScopedAnswerItem[];
  rows?: readonly CompareRowKey[];
  /** The simulation's labels (lib/data-room-chat-config.ts); Tempo's by default. */
  config?: DataRoomChatConfig;
}): React.ReactElement {
  const shownRows = rows.length > 0 ? COMPARE_ROWS.filter((row) => rows.includes(row.key)) : COMPARE_ROWS;
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
                    <CompanyName item={item} onOpenCompany={onOpenCompany} openableCompanyIds={openableCompanyIds} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant text-[12px]">
              {shownRows.map((row) => (
                <tr key={row.key}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-surface py-1.5 px-2.5 text-[11px] font-semibold text-on-surface-variant border-r border-outline-variant align-top"
                  >
                    {config.compareRowLabels[row.key]}
                  </th>
                  {items.map((item, i) => (
                    <td
                      key={item.companyId}
                      className={`py-1.5 px-3 text-on-surface bg-white align-top ${row.isMono ? "font-mono" : ""} ${
                        i < items.length - 1 ? "border-r border-outline-variant" : ""
                      }`}
                    >
                      {item.card ? row.value(item, item.card, config.cardLabels) : MISSING}
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

// ── Text blocks with source tags ───

/** Each tagged source's pill colours: research blue, public gold (card facts have no tag). */
const SOURCE_TAG_CLASSES: Readonly<Record<Exclude<AnswerLine["source"], "card">, string>> = {
  research: "bg-secondary-fixed text-on-secondary-fixed",
  public: "bg-tertiary-fixed text-on-tertiary-fixed",
};

/**
 * One company's lines in a text block: with a "Research" or "Public" tag before each
 * research finding or public signal when its lines carry them; otherwise (old saved
 * replies, card facts only) its text exactly as before.
 */
export function AnswerLines({
  item,
  config = getDataRoomChatConfig(),
}: {
  item: ScopedAnswerItem;
  /** The simulation's tag labels; Tempo's by default. */
  config?: DataRoomChatConfig;
}): React.ReactElement {
  const lines = item.lines ?? [];
  if (!lines.some((line) => line.source !== "card")) {
    return <p className="text-on-surface-variant whitespace-pre-wrap">{item.text}</p>;
  }
  return (
    <div className="text-on-surface-variant space-y-0.5">
      {lines.map((line, i) => (
        <p key={i} className="whitespace-pre-wrap">
          {line.source !== "card" ? (
            <span
              data-source={line.source}
              className={`mr-1.5 inline-block align-[1px] px-1.5 rounded-full text-[10px] font-semibold uppercase tracking-wide leading-[16px] ${SOURCE_TAG_CLASSES[line.source]}`}
            >
              {config.lineSourceTags[line.source]}
            </span>
          ) : null}
          {line.text}
        </p>
      ))}
    </div>
  );
}

// ── The reply body ───

/**
 * One reply's body: the intro, then the companies as text blocks (exactly as before
 * tables existed, with source tags when the lines carry them), a result table or a
 * compare table (answerLayoutOf), then the note, if any. Rendered inside the reply
 * bubble, whose spacing separates the parts. With onOpenCompany, each company name
 * the pane can open is a button (CompanyName); without it, every name is plain text.
 */
export function DataRoomChatAnswer({
  answer,
  config = getDataRoomChatConfig(),
  onOpenCompany,
  openableCompanyIds,
}: CompanyOpenProps & {
  answer: ChatAnswer;
  /** The simulation's labels for the tables; Tempo's by default. */
  config?: DataRoomChatConfig;
}): React.ReactElement {
  const open: CompanyOpenProps = { onOpenCompany, openableCompanyIds };
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
      {layout === "table" ? <ResultTable items={answer.items} config={config} {...open} /> : null}
      {layout === "compare" ? <CompareTable items={answer.items} rows={answer.compareRows} config={config} {...open} /> : null}
      {layout === "list"
        ? answer.items.map((item) => (
            <div key={item.companyId}>
              <p className="text-[12px] font-semibold text-on-surface mb-1">
                <CompanyName item={item} {...open} />
              </p>
              <AnswerLines item={item} config={config} />
            </div>
          ))
        : null}
      {answer.note ? <p className="text-[12px] leading-snug text-on-surface-variant">{answer.note}</p> : null}
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
