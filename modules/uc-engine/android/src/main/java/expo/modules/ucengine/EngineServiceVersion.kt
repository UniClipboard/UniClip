package expo.modules.ucengine

/** Android's display version may include a fourth build segment; Engine accepts SemVer. */
internal fun engineServiceVersion(displayVersion: String): String {
  val match = Regex("^(\\d{1,5}\\.\\d{1,5}\\.\\d{1,5})(?:\\.\\d+)?(-(?:alpha|beta|rc)(?:\\.\\d{1,5})?)?(?:\\+[0-9A-Za-z.-]+)?$").matchEntire(displayVersion)
    ?: throw IllegalArgumentException("Unsupported application version format")
  return match.groupValues[1] + match.groupValues[2]
}
