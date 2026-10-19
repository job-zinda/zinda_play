import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function HomeBanners({ banners, assetSrc }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = banners.length;
  useEffect(() => { if (index >= count) setIndex(0); }, [count, index]);
  useEffect(() => {
    if (count < 2 || paused) return undefined;
    const timer = window.setInterval(() => setIndex(current => (current + 1) % count), 5000);
    return () => window.clearInterval(timer);
  }, [count, paused]);
  if (!count) return null;
  const go = step => setIndex(current => (current + step + count) % count);
  return <section className="promo-banner promo-carousel" aria-label="Featured banners" aria-roledescription="carousel" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
    <div className="promo-carousel-track" style={{ transform: `translateX(-${index * 100}%)` }}>
      {banners.map((banner, i) => {
        const image = <img className="promo-banner-image" src={assetSrc(banner.imageUrl)} alt={banner.title || "Zinda Play"} loading={i === 0 ? "eager" : "lazy"}/>;
        return <div className="promo-slide" key={banner.id} aria-hidden={i !== index}>
          {banner.buttonUrl ? <a href={banner.buttonUrl} target="_blank" rel="noopener noreferrer" tabIndex={i === index ? 0 : -1}>{image}</a> : image}
          {banner.buttonLabel && banner.buttonUrl && <a className="primary-btn promo-slide-btn" href={banner.buttonUrl} target="_blank" rel="noopener noreferrer" tabIndex={i === index ? 0 : -1}>{banner.buttonLabel}</a>}
        </div>;
      })}
    </div>
    {count > 1 && <>
      <button type="button" className="promo-nav prev" aria-label="Previous banner" onClick={() => go(-1)}><ChevronLeft size={20}/></button>
      <button type="button" className="promo-nav next" aria-label="Next banner" onClick={() => go(1)}><ChevronRight size={20}/></button>
      <div className="promo-dots">{banners.map((banner, i) => <button type="button" key={banner.id} className={i === index ? "active" : ""} aria-label={`Show banner ${i + 1}`} aria-current={i === index} onClick={() => setIndex(i)}/>)}</div>
    </>}
  </section>;
}
