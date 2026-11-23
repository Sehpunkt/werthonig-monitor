<?php
/**
 * Plugin Name: Update-Monitor
 * Description: Protokolliert WordPress-Updates, bündelt sie und stößt danach automatische Tests auf GitHub an. Stellt geschützte Prüf-Schnittstellen bereit.
 * Version:     1.0.0
 * Author:      sehpunkt
 *
 * Ablage: wp-content/mu-plugins/update-monitor.php
 *
 * Konfiguration in der wp-config.php (oberhalb von "That's all, stop editing"):
 *   define( 'UPDATE_MONITOR_GITHUB_REPO',  'konto/werthonig-monitor' );
 *   define( 'UPDATE_MONITOR_GITHUB_TOKEN', 'github_pat_...' );
 *   define( 'UPDATE_MONITOR_KEY',          'mind-32-zufaellige-zeichen' );
 *   define( 'UPDATE_MONITOR_TEST_EMAIL',   'test@werthonig.de' );
 *   define( 'UPDATE_MONITOR_WITH_ORDER',   false );   // Testbestellung nach Updates
 *   define( 'UPDATE_MONITOR_DEBOUNCE',     900 );     // Sekunden nach dem letzten Update
 *   define( 'UPDATE_MONITOR_ALERT_EMAIL',  'admin@example.de' ); // optional
 */

defined( 'ABSPATH' ) || exit;

final class Update_Monitor {

	const OPT_SNAPSHOT   = 'um_snapshot';
	const OPT_PENDING    = 'um_pending';
	const OPT_EVENTS     = 'um_events';
	const OPT_ATTEMPTS   = 'um_dispatch_attempts';
	const OPT_LAST_ERRCK = 'um_last_error_check';
	const HOOK_DISPATCH  = 'um_dispatch';
	const HOOK_DAILY     = 'um_daily_check';
	const META_TEST      = '_update_monitor_test_order';
	const REST_NS        = 'update-monitor/v1';
	const MAX_EVENTS     = 100;

	public static function init() {
		add_action( 'upgrader_process_complete', array( __CLASS__, 'on_upgrade' ), 99, 2 );
		add_action( 'automatic_updates_complete', array( __CLASS__, 'on_auto_updates' ), 99 );
		add_action( self::HOOK_DAILY, array( __CLASS__, 'daily_check' ) );
		add_action( self::HOOK_DISPATCH, array( __CLASS__, 'dispatch' ) );
		add_action( 'init', array( __CLASS__, 'schedule_daily' ) );
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
		add_action( 'admin_menu', array( __CLASS__, 'admin_menu' ) );
		add_action( 'admin_post_um_trigger', array( __CLASS__, 'admin_trigger' ) );

		// Testbestellungen markieren (klassische Kasse und Block-Kasse).
		add_action( 'woocommerce_checkout_order_created', array( __CLASS__, 'mark_test_order' ) );
		add_action( 'woocommerce_store_api_checkout_order_processed', array( __CLASS__, 'mark_test_order' ) );

		// Admin-Mails zu Testbestellungen an das Testpostfach umleiten.
		foreach ( array( 'new_order', 'cancelled_order', 'failed_order' ) as $id ) {
			add_filter( 'woocommerce_email_recipient_' . $id, array( __CLASS__, 'redirect_admin_mail' ), 99, 2 );
		}
	}

	/* ------------------------------------------------------------------
	 * Konfiguration
	 * ---------------------------------------------------------------- */

	private static function cfg( $name, $default = '' ) {
		$const = 'UPDATE_MONITOR_' . $name;
		return defined( $const ) ? constant( $const ) : $default;
	}

	private static function test_email() {
		return strtolower( trim( (string) self::cfg( 'TEST_EMAIL' ) ) );
	}

	/* ------------------------------------------------------------------
	 * Versions-Snapshot und Vergleich
	 * ---------------------------------------------------------------- */

	public static function snapshot() {
		if ( ! function_exists( 'get_plugins' ) ) {
			require_once ABSPATH . 'wp-admin/includes/plugin.php';
		}
		if ( function_exists( 'wp_clean_plugins_cache' ) ) {
			wp_clean_plugins_cache( false );
		}
		if ( function_exists( 'wp_clean_themes_cache' ) ) {
			wp_clean_themes_cache( false );
		}

		// Core-Version frisch aus der Datei lesen; $wp_version ist nach einem
		// Core-Update im selben Request noch der alte Wert.
		$core = get_bloginfo( 'version' );
		$file = ABSPATH . WPINC . '/version.php';
		if ( is_readable( $file ) ) {
			$core = ( function () use ( $file ) {
				include $file;
				return isset( $wp_version ) ? $wp_version : '';
			} )();
		}

		$plugins = array();
		foreach ( get_plugins() as $path => $data ) {
			$plugins[ $path ] = array( 'name' => $data['Name'], 'version' => $data['Version'] );
		}
		$themes = array();
		foreach ( wp_get_themes() as $slug => $theme ) {
			$themes[ $slug ] = array( 'name' => $theme->get( 'Name' ), 'version' => $theme->get( 'Version' ) );
		}

		return array(
			'core'    => $core,
			'php'     => PHP_VERSION,
			'plugins' => $plugins,
			'themes'  => $themes,
		);
	}

	private static function diff( $old, $new ) {
		$changes = array();
		foreach ( array( 'core' => 'WordPress', 'php' => 'PHP' ) as $key => $label ) {
			if ( ( $old[ $key ] ?? '' ) !== ( $new[ $key ] ?? '' ) ) {
				$changes[] = array( 'type' => $key, 'name' => $label, 'from' => $old[ $key ] ?? '', 'to' => $new[ $key ] ?? '' );
			}
		}
		foreach ( array( 'plugins' => 'plugin', 'themes' => 'theme' ) as $group => $type ) {
			$o = $old[ $group ] ?? array();
			$n = $new[ $group ] ?? array();
			foreach ( $n as $id => $item ) {
				$from = $o[ $id ]['version'] ?? '';
				if ( $from !== $item['version'] ) {
					$changes[] = array( 'type' => $type, 'name' => $item['name'], 'from' => $from ?: 'neu', 'to' => $item['version'] );
				}
			}
			foreach ( $o as $id => $item ) {
				if ( ! isset( $n[ $id ] ) ) {
					$changes[] = array( 'type' => $type, 'name' => $item['name'], 'from' => $item['version'], 'to' => 'entfernt' );
				}
			}
		}
		return $changes;
	}

	/**
	 * Vergleicht den aktuellen Stand mit dem gespeicherten Snapshot.
	 * Bei Änderungen: merken, Snapshot erneuern, Testlauf (gebündelt) planen.
	 */
	public static function check_changes( $source ) {
		$new = self::snapshot();
		$old = get_option( self::OPT_SNAPSHOT );
		if ( ! is_array( $old ) ) {
			update_option( self::OPT_SNAPSHOT, $new, false );
			self::log( 'snapshot', 'Erster Versions-Snapshot gespeichert.' );
			return array();
		}
		$changes = self::diff( $old, $new );
		if ( ! $changes ) {
			return array();
		}
		update_option( self::OPT_SNAPSHOT, $new, false );

		$pending = get_option( self::OPT_PENDING, array() );
		foreach ( $changes as $c ) {
			$c['source'] = $source;
			$c['time']   = time();
			$pending[]   = $c;
		}
		update_option( self::OPT_PENDING, array_slice( $pending, -200 ), false );

		self::log( 'update', self::changes_text( $changes ), array( 'source' => $source ) );
		self::schedule_dispatch();
		return $changes;
	}

	private static function changes_text( $changes ) {
		$parts = array();
		foreach ( $changes as $c ) {
			$parts[] = sprintf( '%s %s → %s', $c['name'], $c['from'], $c['to'] );
		}
		return implode( '; ', $parts );
	}

	public static function on_upgrade( $upgrader = null, $extra = array() ) {
		self::check_changes( 'update' );
	}

	public static function on_auto_updates( $results = array() ) {
		self::check_changes( 'auto-update' );
	}

	public static function daily_check() {
		self::check_changes( 'daily-check' );
	}

	public static function schedule_daily() {
		if ( ! wp_next_scheduled( self::HOOK_DAILY ) ) {
			wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', self::HOOK_DAILY );
		}
		// Erster Aufruf: Snapshot anlegen, ohne einen Testlauf auszulösen.
		if ( false === get_option( self::OPT_SNAPSHOT, false ) && is_admin() ) {
			self::check_changes( 'install' );
		}
	}

	/* ------------------------------------------------------------------
	 * Bündelung und GitHub-Auslösung
	 * ---------------------------------------------------------------- */

	private static function schedule_dispatch( $delay = null ) {
		$delay = null === $delay ? (int) self::cfg( 'DEBOUNCE', 900 ) : (int) $delay;
		wp_clear_scheduled_hook( self::HOOK_DISPATCH );
		wp_schedule_single_event( time() + max( 60, $delay ), self::HOOK_DISPATCH );
	}

	public static function dispatch( $run_type = 'after-update' ) {
		$pending = get_option( self::OPT_PENDING, array() );
		if ( 'after-update' === $run_type && ! $pending ) {
			return;
		}

		$result = self::send_dispatch( $run_type, $pending );
		if ( true === $result ) {
			delete_option( self::OPT_PENDING );
			delete_option( self::OPT_ATTEMPTS );
			self::log( 'dispatch', sprintf( 'Testlauf ausgelöst (%s, %d Änderungen).', $run_type, count( $pending ) ) );
			return true;
		}

		if ( 'after-update' !== $run_type ) {
			self::log( 'error', 'Auslösen fehlgeschlagen: ' . $result );
			return $result;
		}

		$attempts = (int) get_option( self::OPT_ATTEMPTS, 0 ) + 1;
		update_option( self::OPT_ATTEMPTS, $attempts, false );
		self::log( 'error', sprintf( 'Auslösen fehlgeschlagen (Versuch %d): %s', $attempts, $result ) );

		if ( $attempts < 3 ) {
			self::schedule_dispatch( 300 * $attempts );
		} else {
			delete_option( self::OPT_ATTEMPTS );
			$to = self::cfg( 'ALERT_EMAIL', get_option( 'admin_email' ) );
			wp_mail(
				$to,
				'[Update-Monitor] Testlauf konnte nicht ausgelöst werden – ' . wp_parse_url( home_url(), PHP_URL_HOST ),
				"Nach diesen Updates konnte der Testlauf auf GitHub nicht gestartet werden:\n\n"
				. self::changes_text( $pending ) . "\n\nLetzter Fehler: " . $result
				. "\n\nBitte Token und Repository in der wp-config.php prüfen und die Seite manuell testen."
			);
		}
		return $result;
	}

	/** @return true|string true bei Erfolg, sonst Fehlertext */
	private static function send_dispatch( $run_type, $pending ) {
		$repo  = self::cfg( 'GITHUB_REPO' );
		$token = self::cfg( 'GITHUB_TOKEN' );
		if ( ! $repo || ! $token ) {
			return 'UPDATE_MONITOR_GITHUB_REPO oder _TOKEN fehlt.';
		}
		$changes = array();
		foreach ( array_slice( $pending, -50 ) as $c ) {
			$changes[] = array(
				'name' => $c['name'],
				'from' => $c['from'],
				'to'   => $c['to'],
			);
		}
		$body = array(
			'event_type'     => 'wp-updated',
			'client_payload' => array(
				'site'       => home_url( '/' ),
				'run_type'   => $run_type,
				'with_order' => (bool) self::cfg( 'WITH_ORDER', false ),
				'changes'    => $changes,
			),
		);
		$response = wp_remote_post(
			'https://api.github.com/repos/' . $repo . '/dispatches',
			array(
				'timeout' => 20,
				'headers' => array(
					'Authorization'        => 'Bearer ' . $token,
					'Accept'               => 'application/vnd.github+json',
					'X-GitHub-Api-Version' => '2022-11-28',
					'Content-Type'         => 'application/json',
					'User-Agent'           => 'Update-Monitor',
				),
				'body'    => wp_json_encode( $body ),
			)
		);
		if ( is_wp_error( $response ) ) {
			return $response->get_error_message();
		}
		$code = (int) wp_remote_retrieve_response_code( $response );
		return 204 === $code ? true : 'HTTP ' . $code . ' ' . substr( wp_remote_retrieve_body( $response ), 0, 200 );
	}

	/* ------------------------------------------------------------------
	 * Protokoll
	 * ---------------------------------------------------------------- */

	private static function log( $type, $message, $extra = array() ) {
		$events   = get_option( self::OPT_EVENTS, array() );
		$events[] = array_merge( array( 'time' => time(), 'type' => $type, 'message' => $message ), $extra );
		update_option( self::OPT_EVENTS, array_slice( $events, -self::MAX_EVENTS ), false );
	}

	/* ------------------------------------------------------------------
	 * Testbestellungen
	 * ---------------------------------------------------------------- */

	private static function is_test_order( $order ) {
		if ( ! $order instanceof WC_Order || ! self::test_email() ) {
			return false;
		}
		return strtolower( trim( $order->get_billing_email() ) ) === self::test_email();
	}

	public static function mark_test_order( $order ) {
		if ( self::is_test_order( $order ) && 'yes' !== $order->get_meta( self::META_TEST ) ) {
			$order->update_meta_data( self::META_TEST, 'yes' );
			$order->save();
		}
	}

	public static function redirect_admin_mail( $recipient, $order = null ) {
		return self::is_test_order( $order ) ? self::test_email() : $recipient;
	}

	/* ------------------------------------------------------------------
	 * REST-Schnittstellen
	 * ---------------------------------------------------------------- */

	public static function register_routes() {
		$routes = array(
			'/status'       => array( 'GET', 'rest_status' ),
			'/test-mail'    => array( 'POST', 'rest_test_mail' ),
			'/php-errors'   => array( 'GET', 'rest_php_errors' ),
			'/cleanup-order' => array( 'POST', 'rest_cleanup_order' ),
			'/report'       => array( 'POST', 'rest_report' ),
		);
		foreach ( $routes as $route => $def ) {
			register_rest_route(
				self::REST_NS,
				$route,
				array(
					'methods'             => $def[0],
					'callback'            => array( __CLASS__, $def[1] ),
					'permission_callback' => array( __CLASS__, 'check_key' ),
				)
			);
		}
	}

	public static function check_key( WP_REST_Request $request ) {
		$ip    = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
		$tkey  = 'um_fail_' . md5( $ip );
		$fails = (int) get_transient( $tkey );
		if ( $fails >= 5 ) {
			return new WP_Error( 'um_locked', 'Zu viele Fehlversuche.', array( 'status' => 429 ) );
		}
		$key   = (string) self::cfg( 'KEY' );
		$given = (string) $request->get_header( 'x-monitor-key' );
		if ( strlen( $key ) >= 32 && hash_equals( $key, $given ) ) {
			return true;
		}
		set_transient( $tkey, $fails + 1, 15 * MINUTE_IN_SECONDS );
		return new WP_Error( 'um_forbidden', 'Kein Zugriff.', array( 'status' => 403 ) );
	}

	public static function rest_status() {
		$snap = self::snapshot();
		$active = (array) get_option( 'active_plugins', array() );

		$plugins = array();
		$german_market = '';
		foreach ( $snap['plugins'] as $path => $p ) {
			$is_active = in_array( $path, $active, true );
			$plugins[] = array( 'name' => $p['name'], 'version' => $p['version'], 'active' => $is_active );
			if ( $is_active && false !== stripos( $p['name'], 'German Market' ) ) {
				$german_market = $p['version'];
			}
		}

		$theme = wp_get_theme();
		$smtp  = false;
		foreach ( array( 'fluent-smtp/fluent-smtp.php', 'wp-mail-smtp/wp_mail_smtp.php', 'wp-mail-smtp-pro/wp_mail_smtp.php', 'post-smtp/postman-smtp.php' ) as $p ) {
			$smtp = $smtp || in_array( $p, $active, true );
		}

		$display_errors = filter_var( ini_get( 'display_errors' ), FILTER_VALIDATE_BOOLEAN ) || 'stdout' === ini_get( 'display_errors' );

		$urls = array();
		if ( function_exists( 'wc_get_cart_url' ) ) {
			$urls = array(
				'shop'      => get_permalink( wc_get_page_id( 'shop' ) ),
				'cart'      => wc_get_cart_url(),
				'checkout'  => wc_get_checkout_url(),
				'myaccount' => get_permalink( wc_get_page_id( 'myaccount' ) ),
			);
		}

		return array(
			'site'          => home_url( '/' ),
			'wordpress'     => $snap['core'],
			'php'           => PHP_VERSION,
			'woocommerce'   => defined( 'WC_VERSION' ) ? WC_VERSION : '',
			'german_market' => $german_market,
			'theme'         => array(
				'name'    => $theme->get( 'Name' ),
				'version' => $theme->get( 'Version' ),
				'parent'  => $theme->parent() ? $theme->parent()->get( 'Name' ) . ' ' . $theme->parent()->get( 'Version' ) : '',
			),
			'plugins'       => $plugins,
			'urls'          => $urls,
			'checks'        => array(
				'display_errors'   => $display_errors,
				'wp_debug_display' => defined( 'WP_DEBUG' ) && WP_DEBUG && ( ! defined( 'WP_DEBUG_DISPLAY' ) || WP_DEBUG_DISPLAY ),
				'wp_debug_log'     => defined( 'WP_DEBUG_LOG' ) && WP_DEBUG_LOG,
				'wp_cron_disabled' => defined( 'DISABLE_WP_CRON' ) && DISABLE_WP_CRON,
				'smtp_plugin'      => $smtp,
				'test_email_set'   => (bool) self::test_email(),
				'with_order'       => (bool) self::cfg( 'WITH_ORDER', false ),
			),
			'events'        => array_slice( get_option( self::OPT_EVENTS, array() ), -20 ),
			'pending'       => get_option( self::OPT_PENDING, array() ),
		);
	}

	public static function rest_test_mail() {
		$to = self::test_email();
		if ( ! $to ) {
			return new WP_Error( 'um_no_mail', 'UPDATE_MONITOR_TEST_EMAIL fehlt.', array( 'status' => 500 ) );
		}
		$token = wp_generate_password( 12, false );
		$error = '';
		$catch = function ( $wp_error ) use ( &$error ) {
			$error = $wp_error->get_error_message();
		};
		add_action( 'wp_mail_failed', $catch );
		$sent = wp_mail(
			$to,
			'[Update-Monitor] Testmail ' . $token,
			"Automatische Testmail des Update-Monitors.\nToken: " . $token
		);
		remove_action( 'wp_mail_failed', $catch );

		return array( 'sent' => (bool) $sent, 'token' => $token, 'error' => $error );
	}

	private static function log_file() {
		if ( defined( 'WP_DEBUG_LOG' ) && is_string( WP_DEBUG_LOG ) && WP_DEBUG_LOG ) {
			return WP_DEBUG_LOG;
		}
		$ini = ini_get( 'error_log' );
		if ( $ini && is_readable( $ini ) ) {
			return $ini;
		}
		return WP_CONTENT_DIR . '/debug.log';
	}

	public static function rest_php_errors( WP_REST_Request $request ) {
		$since = $request->get_param( 'since' );
		$since = null !== $since ? (int) $since : (int) get_option( self::OPT_LAST_ERRCK, time() - DAY_IN_SECONDS );
		$now   = time();

		$file   = self::log_file();
		$counts = array( 'fatal' => 0, 'warning' => 0, 'notice' => 0, 'deprecated' => 0, 'other' => 0 );
		$msgs   = array();

		if ( is_readable( $file ) ) {
			$size = filesize( $file );
			$fh   = fopen( $file, 'rb' );
			if ( $fh ) {
				$read = min( $size, 1024 * 1024 );
				fseek( $fh, $size - $read );
				$chunk = fread( $fh, $read );
				fclose( $fh );

				foreach ( explode( "\n", $chunk ) as $line ) {
					if ( ! preg_match( '/^\[([^\]]+)\]\s+(?:PHP\s+)?(.+)$/', $line, $m ) ) {
						continue;
					}
					$ts = strtotime( $m[1] );
					if ( ! $ts || $ts <= $since ) {
						continue;
					}
					$text = $m[2];
					if ( preg_match( '/^(Fatal error|Parse error|Uncaught)/i', $text ) ) {
						$type = 'fatal';
					} elseif ( preg_match( '/^Warning/i', $text ) ) {
						$type = 'warning';
					} elseif ( preg_match( '/^Notice/i', $text ) ) {
						$type = 'notice';
					} elseif ( preg_match( '/^Deprecated/i', $text ) ) {
						$type = 'deprecated';
					} else {
						$type = 'other';
					}
					$counts[ $type ]++;
					$text = str_replace( untrailingslashit( ABSPATH ), '…', $text );
					$text = mb_substr( $text, 0, 300 );
					$key  = $type . '|' . $text;
					if ( isset( $msgs[ $key ] ) ) {
						$msgs[ $key ]['count']++;
						$msgs[ $key ]['last'] = $ts;
					} else {
						$msgs[ $key ] = array( 'type' => $type, 'message' => $text, 'count' => 1, 'last' => $ts );
					}
				}
			}
		}

		if ( null === $request->get_param( 'since' ) ) {
			update_option( self::OPT_LAST_ERRCK, $now, false );
		}

		return array(
			'since'    => $since,
			'until'    => $now,
			'log_found' => is_readable( $file ),
			'counts'   => $counts,
			'messages' => array_slice( array_values( $msgs ), -25 ),
		);
	}

	public static function rest_cleanup_order( WP_REST_Request $request ) {
		if ( ! function_exists( 'wc_get_order' ) ) {
			return new WP_Error( 'um_no_wc', 'WooCommerce ist nicht aktiv.', array( 'status' => 500 ) );
		}
		$order = wc_get_order( absint( $request->get_param( 'order_id' ) ) );
		if ( ! $order || ! self::is_test_order( $order ) ) {
			return new WP_Error( 'um_not_test', 'Keine Testbestellung – wird nicht angefasst.', array( 'status' => 400 ) );
		}
		self::mark_test_order( $order );
		if ( 'cancelled' !== $order->get_status() ) {
			$order->update_status( 'cancelled', 'Automatische Testbestellung (Update-Monitor) storniert.' );
		}
		self::log( 'order', 'Testbestellung #' . $order->get_order_number() . ' storniert.' );
		return array( 'order_id' => $order->get_id(), 'status' => $order->get_status() );
	}

	public static function rest_report( WP_REST_Request $request ) {
		$status  = sanitize_key( (string) $request->get_param( 'status' ) );
		$summary = sanitize_text_field( (string) $request->get_param( 'summary' ) );
		$url     = esc_url_raw( (string) $request->get_param( 'run_url' ) );
		self::log( 'result', ( 'passed' === $status ? 'Tests bestanden' : 'Tests FEHLGESCHLAGEN' ) . ( $summary ? ': ' . $summary : '' ), array( 'url' => $url, 'status' => $status ) );
		return array( 'ok' => true );
	}

	/* ------------------------------------------------------------------
	 * Admin-Seite unter Werkzeuge
	 * ---------------------------------------------------------------- */

	public static function admin_menu() {
		add_management_page( 'Update-Monitor', 'Update-Monitor', 'manage_options', 'update-monitor', array( __CLASS__, 'admin_page' ) );
	}

	public static function admin_trigger() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'Kein Zugriff.' );
		}
		check_admin_referer( 'um_trigger' );
		$result = self::dispatch( 'manual' );
		$flag   = true === $result ? 'ok' : 'error';
		wp_safe_redirect( admin_url( 'tools.php?page=update-monitor&um=' . $flag ) );
		exit;
	}

	public static function admin_page() {
		$checks = array(
			'GitHub-Repository'  => (bool) self::cfg( 'GITHUB_REPO' ),
			'GitHub-Token'       => (bool) self::cfg( 'GITHUB_TOKEN' ),
			'Prüf-Schlüssel (≥ 32 Zeichen)' => strlen( (string) self::cfg( 'KEY' ) ) >= 32,
			'Testadresse'        => (bool) self::test_email(),
			'Fehleranzeige aus'  => ! filter_var( ini_get( 'display_errors' ), FILTER_VALIDATE_BOOLEAN ),
			'System-Cron (DISABLE_WP_CRON)' => defined( 'DISABLE_WP_CRON' ) && DISABLE_WP_CRON,
		);
		$events  = array_reverse( get_option( self::OPT_EVENTS, array() ) );
		$pending = get_option( self::OPT_PENDING, array() );
		$next    = wp_next_scheduled( self::HOOK_DISPATCH );
		$fmt     = get_option( 'date_format' ) . ' ' . get_option( 'time_format' );
		?>
		<div class="wrap">
			<h1>Update-Monitor</h1>
			<?php if ( isset( $_GET['um'] ) ) : // phpcs:ignore WordPress.Security.NonceVerification ?>
				<div class="notice notice-<?php echo 'ok' === $_GET['um'] ? 'success' : 'error'; // phpcs:ignore ?>"><p>
					<?php echo 'ok' === $_GET['um'] ? 'Testlauf wurde ausgelöst. Das Protokoll kommt per Mail.' : 'Auslösen fehlgeschlagen – siehe Protokoll unten.'; // phpcs:ignore ?>
				</p></div>
			<?php endif; ?>

			<h2>Einrichtung</h2>
			<table class="widefat striped" style="max-width:640px"><tbody>
			<?php foreach ( $checks as $label => $ok ) : ?>
				<tr><td><?php echo esc_html( $label ); ?></td><td><?php echo $ok ? '✅' : '⚠️'; ?></td></tr>
			<?php endforeach; ?>
				<tr><td>Testbestellung nach Updates</td><td><?php echo self::cfg( 'WITH_ORDER', false ) ? 'an' : 'aus'; ?></td></tr>
			</tbody></table>

			<h2>Wartende Änderungen</h2>
			<?php if ( $pending ) : ?>
				<p><?php echo esc_html( self::changes_text( $pending ) ); ?></p>
				<p>Testlauf geplant: <?php echo $next ? esc_html( wp_date( $fmt, $next ) ) : '–'; ?></p>
			<?php else : ?>
				<p>Keine.</p>
			<?php endif; ?>

			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="um_trigger">
				<?php wp_nonce_field( 'um_trigger' ); ?>
				<?php submit_button( 'Testlauf jetzt auslösen', 'secondary', 'submit', false ); ?>
			</form>

			<h2>Protokoll (letzte <?php echo (int) self::MAX_EVENTS; ?>)</h2>
			<table class="widefat striped"><thead><tr><th style="width:170px">Zeit</th><th style="width:90px">Art</th><th>Eintrag</th></tr></thead><tbody>
			<?php foreach ( $events as $e ) : ?>
				<tr>
					<td><?php echo esc_html( wp_date( $fmt, $e['time'] ) ); ?></td>
					<td><?php echo esc_html( $e['type'] ); ?></td>
					<td><?php echo esc_html( $e['message'] ); ?>
						<?php if ( ! empty( $e['url'] ) ) : ?> – <a href="<?php echo esc_url( $e['url'] ); ?>" target="_blank" rel="noopener">Bericht</a><?php endif; ?>
					</td>
				</tr>
			<?php endforeach; ?>
			<?php if ( ! $events ) : ?><tr><td colspan="3">Noch keine Einträge.</td></tr><?php endif; ?>
			</tbody></table>
		</div>
		<?php
	}
}

Update_Monitor::init();
