<?php
/**
 * Private file storage, resumable chunked uploads and safe downloads.
 *
 * Files never live in a public folder. They are served only through the API after an access
 * check, with the type decided by the server (not the uploader), and anything that a browser
 * could run (HTML, SVG, scripts) is always sent as a download inside a sandbox.
 *
 * @package Project_Desk
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/** Chunk size the app sends, in bytes. Keep below the host's post_max_size. */
const PD_CHUNK_BYTES = 8 * 1024 * 1024;

/** Allowed extensions and the kind of asset each one is. */
function pd_allowed_extensions(): array {
	$map = array(
		'image'    => array( 'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'avif', 'svg', 'tif', 'tiff', 'bmp' ),
		'video'    => array( 'mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv', '3gp' ),
		'audio'    => array( 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus' ),
		'document' => array( 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'txt', 'md', 'rtf', 'odt', 'ods', 'odp', 'pages', 'key', 'numbers' ),
		'design'   => array( 'ai', 'psd', 'eps', 'fig', 'sketch', 'xd', 'indd', 'otf', 'ttf', 'woff', 'woff2' ),
		'archive'  => array( 'zip', 'rar', '7z' ),
	);
	$out = array();
	foreach ( $map as $kind => $exts ) {
		foreach ( $exts as $ext ) {
			$out[ $ext ] = $kind;
		}
	}
	return (array) apply_filters( 'pd_allowed_extensions', $out );
}

/** Types a browser may show in the page. Everything else is a download. SVG is deliberately excluded. */
function pd_inline_mimes(): array {
	return array(
		'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
		'video/mp4', 'video/webm', 'video/quicktime',
		'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/aac', 'audio/ogg',
		'application/pdf',
	);
}

/** Private storage root, created with deny rules on first use. Override with PD_STORAGE_DIR (ideally outside the web root). */
function pd_storage_dir(): string {
	if ( defined( 'PD_STORAGE_DIR' ) ) {
		$dir = rtrim( (string) PD_STORAGE_DIR, '/\\' );
	} else {
		$uploads = wp_upload_dir( null, false );
		$dir     = rtrim( $uploads['basedir'], '/\\' ) . '/project-desk-private';
	}
	if ( ! is_dir( $dir ) ) {
		wp_mkdir_p( $dir );
	}
	if ( ! file_exists( $dir . '/.htaccess' ) ) {
		file_put_contents( $dir . '/.htaccess', "Require all denied\nDeny from all\n" ); // phpcs:ignore WordPress.WP.AlternativeFunctions
	}
	if ( ! file_exists( $dir . '/index.php' ) ) {
		file_put_contents( $dir . '/index.php', "<?php\n// Silence.\n" ); // phpcs:ignore WordPress.WP.AlternativeFunctions
	}
	if ( ! is_dir( $dir . '/tmp' ) ) {
		wp_mkdir_p( $dir . '/tmp' );
	}
	return $dir;
}

/** A filename safe to store and show. */
function pd_safe_filename( string $name ): string {
	$name = sanitize_file_name( wp_basename( $name ) );
	$name = preg_replace( '/[^\w.\-() ]+/u', '_', $name );
	return mb_substr( $name ? $name : 'file', 0, 160 );
}

/** Extension of a file name, lowercased. */
function pd_extension( string $name ): string {
	return strtolower( (string) pathinfo( $name, PATHINFO_EXTENSION ) );
}

/** Server-side MIME detection from the file's bytes. */
function pd_detect_mime( string $path, string $name ): string {
	$mime = '';
	if ( function_exists( 'finfo_open' ) ) {
		$finfo = finfo_open( FILEINFO_MIME_TYPE );
		$mime  = (string) finfo_file( $finfo, $path );
		finfo_close( $finfo );
	}
	if ( ! $mime || 'application/octet-stream' === $mime ) {
		$check = wp_check_filetype( $name );
		$mime  = $check['type'] ? $check['type'] : 'application/octet-stream';
	}
	return $mime;
}

/** Path for an upload session's partial file. */
function pd_upload_part_path( string $upload_id ): string {
	return pd_storage_dir() . '/tmp/' . $upload_id . '.part';
}

/** Starts a resumable upload. Returns the session or an error. */
function pd_upload_start( int $user_id, array $project, string $name, int $size, string $category, int $replaces = 0 ) {
	$s    = pd_settings();
	$name = pd_safe_filename( $name );
	$ext  = pd_extension( $name );
	if ( ! isset( pd_allowed_extensions()[ $ext ] ) ) {
		return pd_error( 'That file type is not accepted. Send images, video, audio, documents, design files or a zip.', 415 );
	}
	if ( $size <= 0 ) {
		return pd_error( 'That file is empty.' );
	}
	if ( $size > (int) $s['max_upload_mb'] * 1024 * 1024 ) {
		return pd_error( sprintf( 'Files are limited to %d MB each.', (int) $s['max_upload_mb'] ), 413 );
	}
	$id      = wp_generate_uuid4();
	$session = array(
		'id'         => $id,
		'user_id'    => $user_id,
		'project_id' => (int) $project['id'],
		'client_id'  => (int) $project['client_id'],
		'name'       => $name,
		'size'       => $size,
		'category'   => 'payments' === $category ? 'payments' : pd_one_of( $category, $s['asset_categories'], 'brief' ),
		'replaces'   => $replaces,
		'received'   => 0,
	);
	set_transient( 'pd_upload_' . $id, $session, DAY_IN_SECONDS );
	file_put_contents( pd_upload_part_path( $id ), '' ); // phpcs:ignore WordPress.WP.AlternativeFunctions
	return $session;
}

/** Loads an upload session that belongs to $user_id. */
function pd_upload_session( string $upload_id, int $user_id ) {
	if ( ! preg_match( '/^[0-9a-f-]{36}$/', $upload_id ) ) {
		return pd_error( 'Upload not found.', 404 );
	}
	$session = get_transient( 'pd_upload_' . $upload_id );
	if ( ! is_array( $session ) || (int) $session['user_id'] !== $user_id ) {
		return pd_error( 'Upload not found or expired. Start the upload again.', 404 );
	}
	return $session;
}

/** Appends one chunk at $offset. Offsets must match what the server has, which makes retries safe. */
function pd_upload_chunk( array $session, int $offset, string $bytes ) {
	if ( $offset !== (int) $session['received'] ) {
		return pd_error( 'Chunk out of order.', 409, 'pd_offset' );
	}
	$len = strlen( $bytes );
	if ( 0 === $len || $len > PD_CHUNK_BYTES ) {
		return pd_error( 'Each piece must be between 1 byte and 8 MB.' );
	}
	if ( $session['received'] + $len > $session['size'] ) {
		return pd_error( 'More data than the file size you declared.' );
	}
	$written = file_put_contents( pd_upload_part_path( $session['id'] ), $bytes, FILE_APPEND | LOCK_EX ); // phpcs:ignore WordPress.WP.AlternativeFunctions
	if ( $written !== $len ) {
		return pd_error( 'Could not save that piece. Try again.', 500 );
	}
	$session['received'] += $len;
	set_transient( 'pd_upload_' . $session['id'], $session, DAY_IN_SECONDS );
	return $session;
}

/** Completes an upload: checks size and type, moves the file into storage and returns the stored file details. */
function pd_upload_finish( array $session ) {
	$part = pd_upload_part_path( $session['id'] );
	clearstatcache( true, $part );
	if ( ! file_exists( $part ) || filesize( $part ) !== (int) $session['size'] ) {
		return pd_error( 'The upload is incomplete. Send the remaining pieces first.', 409 );
	}
	$mime = pd_detect_mime( $part, $session['name'] );
	if ( preg_match( '/(php|x-httpd|x-sh|x-executable|x-msdownload|x-dosexec)/i', $mime ) ) {
		wp_delete_file( $part );
		delete_transient( 'pd_upload_' . $session['id'] );
		return pd_error( 'That file looks like a program and was refused.', 415 );
	}
	$rel_dir = (int) $session['client_id'] . '/' . (int) $session['project_id'];
	$dir     = pd_storage_dir() . '/' . $rel_dir;
	wp_mkdir_p( $dir );
	$key = $rel_dir . '/' . wp_generate_uuid4() . '-' . $session['name'];
	if ( ! rename( $part, pd_storage_dir() . '/' . $key ) ) { // phpcs:ignore WordPress.WP.AlternativeFunctions
		return pd_error( 'Could not store the file. Try again.', 500 );
	}
	delete_transient( 'pd_upload_' . $session['id'] );
	return array(
		'storage_key' => $key,
		'mime'        => $mime,
		'size'        => (int) $session['size'],
		'kind'        => pd_allowed_extensions()[ pd_extension( $session['name'] ) ] ?? 'other',
	);
}

/** Headers for sending a stored file. Unsafe types are always downloads and sandboxed. */
function pd_file_headers( string $mime, string $name, int $size ): array {
	$inline = in_array( $mime, pd_inline_mimes(), true );
	return array(
		'Content-Type'            => $inline ? $mime : 'application/octet-stream',
		'Content-Length'          => (string) $size,
		'Content-Disposition'     => ( $inline ? 'inline' : 'attachment' ) . "; filename*=UTF-8''" . rawurlencode( $name ),
		'X-Content-Type-Options'  => 'nosniff',
		'Content-Security-Policy' => "default-src 'none'; sandbox",
		'Cache-Control'           => 'private, no-store',
	);
}

/**
 * Reads a single "bytes=" range. Returns [start, end] (inclusive), null when there is no usable
 * range (send the whole file), or false when the range is outside the file (answer 416).
 * Phones need this to play and seek videos.
 */
function pd_parse_range( string $header, int $size ) {
	if ( ! preg_match( '/^bytes=(\d*)-(\d*)$/', trim( $header ), $m ) || ( '' === $m[1] && '' === $m[2] ) ) {
		return null;
	}
	if ( '' === $m[1] ) {
		$length = min( (int) $m[2], $size );
		return $length > 0 ? array( $size - $length, $size - 1 ) : false;
	}
	$start = (int) $m[1];
	$end   = '' === $m[2] ? $size - 1 : min( (int) $m[2], $size - 1 );
	return ( $start >= $size || $start > $end ) ? false : array( $start, $end );
}

/** Streams a stored file (whole or one byte range) and ends the request. */
function pd_send_file( array $asset ): void {
	$path = pd_storage_dir() . '/' . $asset['storage_key'];
	$real = realpath( $path );
	$root = realpath( pd_storage_dir() );
	if ( ! $real || ! $root || 0 !== strpos( $real, $root ) || ! is_file( $real ) ) {
		status_header( 404 );
		exit;
	}
	$size  = (int) filesize( $real );
	$range = isset( $_SERVER['HTTP_RANGE'] ) ? pd_parse_range( sanitize_text_field( wp_unslash( $_SERVER['HTTP_RANGE'] ) ), $size ) : null;
	nocache_headers();
	foreach ( pd_file_headers( (string) $asset['mime'], (string) $asset['name'], $size ) as $h => $v ) {
		header( $h . ': ' . $v );
	}
	header( 'Accept-Ranges: bytes' );
	while ( ob_get_level() ) {
		ob_end_clean();
	}
	if ( false === $range ) {
		status_header( 416 );
		header( 'Content-Range: bytes */' . $size );
		header( 'Content-Length: 0' );
		exit;
	}
	if ( null === $range ) {
		readfile( $real ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		exit;
	}
	[ $start, $end ] = $range;
	status_header( 206 );
	header( 'Content-Range: bytes ' . $start . '-' . $end . '/' . $size );
	header( 'Content-Length: ' . ( $end - $start + 1 ) );
	$fh = fopen( $real, 'rb' ); // phpcs:ignore WordPress.WP.AlternativeFunctions
	fseek( $fh, $start );
	$left = $end - $start + 1;
	while ( $left > 0 && ! feof( $fh ) ) {
		$chunk = fread( $fh, min( 1048576, $left ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions
		if ( false === $chunk ) {
			break;
		}
		echo $chunk; // phpcs:ignore WordPress.Security.EscapeOutput
		$left -= strlen( $chunk );
		flush();
	}
	fclose( $fh ); // phpcs:ignore WordPress.WP.AlternativeFunctions
	exit;
}

/** Daily: removes partial uploads older than a day. */
function pd_cleanup_stale_uploads(): void {
	foreach ( glob( pd_storage_dir() . '/tmp/*.part' ) ?: array() as $file ) {
		if ( filemtime( $file ) < time() - DAY_IN_SECONDS ) {
			wp_delete_file( $file );
		}
	}
}
