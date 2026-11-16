/** A small still from the middle of a sign (about 5 KB), loaded only when it scrolls into view. */
export default function SignThumb({ id }: { id: string }) {
  return <img className="sign-thumb" src={`/signs/${id}.jpg`} alt="" loading="lazy" width={64} height={48} />
}
