import { Film, Play } from "lucide-react";

export default function CreatorVideos({ videos = [], renderCard }) {
  return [false, true].map(short => {
    const items = videos.filter(video => (video.videoType === "short") === short);
    const Icon = short ? Play : Film;
    return <section className="creator-media-section" key={String(short)}>
      <h3><Icon size={24} aria-hidden="true"/> {short ? "Simply" : "Videos"}</h3>
      {items.length
        ? <div className="vgrid">{items.map((video, index) => renderCard(video, index))}</div>
        : <p className="muted">No {short ? "Simply videos" : "videos"} published yet.</p>}
    </section>;
  });
}
