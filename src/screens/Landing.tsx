import html from '../landing.html?raw'

export default function Landing() {
  return <div dangerouslySetInnerHTML={{ __html: html }} />
}
