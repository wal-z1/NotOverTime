const ICON_PATHS = {
  play: 'M8 5v14l11-7L8 5Z',
  pause: 'M7 5h3v14H7zM14 5h3v14h-3z',
  reset: 'M4 12a8 8 0 1 0 2.3-5.7L4 8.6M4 4v4.6h4.6',
  edit: 'm4 16.8-.8 3.9 3.9-.8L18.6 8.4a2.1 2.1 0 0 0-3-3L4 16.8Z',
  duplicate: 'M8 8h11v12H8zM5 16H3V3h13v2',
  trash: 'M5 7h14M10 11v5m4-5v5M8 7l1-3h6l1 3m-9 0 1 13h8l1-13',
};

export default function Icon({ name }) {
  return (
    <svg className="button-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
