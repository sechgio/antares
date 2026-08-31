interface AntaresSceneProps {
  reducedMotion: boolean;
}

export default function AntaresScene({ reducedMotion }: AntaresSceneProps) {
  if (reducedMotion) {
    return (
      <img
        className="at-login__video-media"
        src="./sign-up-image.png"
        alt=""
        draggable={false}
      />
    );
  }

  return (
    <video
      className="at-login__video-media"
      autoPlay
      loop
      muted
      playsInline
      poster="./sign-up-image.png"
      preload="metadata"
    >
      <source src="./sign-up-video.mp4" type="video/mp4" />
    </video>
  );
}
