/**
 * ManagerNoteCard.tsx
 * The yellow manager-note card (#FFF4CC / #584400): a campaign icon and title,
 * the note's paragraphs, and an optional footer row over a thin rule. Fills its
 * row's height with the footer at the bottom. Used by the live-call lobbies
 * (TempoCallLobby, footer: the transcript tip).
 */

import { MaterialIcon } from "@/components/ui/MaterialIcon";

type ManagerNoteCardProps = {
  title: string;
  paragraphs: readonly string[];
  footer?: React.ReactNode;
};

/** The yellow manager note card. */
export function ManagerNoteCard({ title, paragraphs, footer }: ManagerNoteCardProps): React.ReactElement {
  return (
    <div className="h-full flex flex-col rounded-xl p-6 shadow-sm bg-[#FFF4CC] border border-[rgba(180,130,0,0.3)] text-[#584400]">
      <div className="flex items-center gap-2 mb-4">
        <MaterialIcon name="campaign" className="text-[20px]" />
        <h3 className="font-bold text-[16px]">{title}</h3>
      </div>
      <div className="flex-1 space-y-3 text-[15px] leading-[1.65]">
        {paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
      {footer ? (
        <div className="mt-6 pt-4 border-t border-[rgba(88,68,0,0.15)] flex items-start gap-2.5">{footer}</div>
      ) : null}
    </div>
  );
}
