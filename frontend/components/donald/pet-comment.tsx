import type { CSSProperties } from 'react'
import type { PetComment as PetCommentData } from '@/data/action-impact'

export const PET_COMMENT_COLORS: Record<PetCommentData['category'], string> = {
  money: '#7DC371',
  operational: '#88C2F8',
}

type PetCommentProps = {
  comment: PetCommentData
}

export function PetComment({ comment }: PetCommentProps) {
  const style = { '--pet-comment-bg': PET_COMMENT_COLORS[comment.category] } as CSSProperties & Record<'--pet-comment-bg', string>

  return (
    <div className={`pet-comment pet-comment-${comment.category}`} style={style}>
      <p>{comment.text}</p>
    </div>
  )
}
