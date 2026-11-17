<?php
/**
 * Internal team tasks: the studio's own to-do items, assigned to staff and optionally tied to a
 * project, so the team can see who is carrying what. Clients never see these.
 *
 * @package Project_Desk
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const PD_TASK_STATUSES   = array( 'todo', 'doing', 'done' );
const PD_TASK_PRIORITIES = array( 'low', 'normal', 'high' );

/** A task row shaped for the app. */
function pd_map_task( array $x ): array {
	$assignee = $x['assignee_id'] ? get_user_by( 'id', (int) $x['assignee_id'] ) : null;
	return array(
		'id'           => (int) $x['id'],
		'projectId'    => $x['project_id'] ? (int) $x['project_id'] : null,
		'title'        => (string) $x['title'],
		'details'      => (string) ( $x['details'] ?? '' ),
		'assigneeId'   => $x['assignee_id'] ? (int) $x['assignee_id'] : null,
		'assigneeName' => $assignee ? $assignee->display_name : '',
		'status'       => (string) $x['status'],
		'priority'     => (string) $x['priority'],
		'dueDate'      => $x['due_date'] ?: null,
		'createdAt'    => pd_iso( $x['created_at'] ),
		'completedAt'  => pd_iso( $x['completed_at'] ),
	);
}

/** All tasks for the team console: open ones first, then by priority and due date. */
function pd_load_tasks(): array {
	global $wpdb;
	$rows = $wpdb->get_results( // phpcs:ignore WordPress.DB.PreparedSQL.NotPrepared
		'SELECT * FROM ' . pd_table( 'tasks' ) . "
		ORDER BY (status = 'done') ASC,
			FIELD(priority, 'high', 'normal', 'low'),
			due_date IS NULL, due_date ASC, id DESC",
		ARRAY_A
	);
	return array_map( 'pd_map_task', $rows );
}

/** A light roster of staff the team can assign tasks to: id and name only. */
function pd_team_roster(): array {
	$users = get_users( array( 'role__in' => array( 'pd_owner', 'pd_manager', 'administrator' ), 'orderby' => 'display_name' ) );
	return array_map( static fn( WP_User $u ) => array( 'id' => $u->ID, 'name' => $u->display_name ), $users );
}

/** A staff user id that can own a task, or null. */
function pd_task_assignee( $value ): ?int {
	$id = (int) $value;
	if ( ! $id ) {
		return null;
	}
	$user = get_user_by( 'id', $id );
	return $user && user_can( $user, 'pd_manage_projects' ) ? $id : null;
}

/** Creates a task. Returns the task id or a WP_Error. */
function pd_create_task( array $b ) {
	global $wpdb;
	$title = pd_text( $b['title'] ?? '', 200 );
	if ( ! $title ) {
		return pd_error( 'Give the task a title.' );
	}
	$project_id = (int) ( $b['projectId'] ?? 0 );
	if ( $project_id && ! pd_get_row( 'projects', $project_id ) ) {
		return pd_error( 'That project does not exist.' );
	}
	$assignee = pd_task_assignee( $b['assigneeId'] ?? 0 );
	$wpdb->insert(
		pd_table( 'tasks' ),
		array(
			'project_id'  => $project_id ?: null,
			'title'       => $title,
			'details'     => pd_textarea( $b['details'] ?? '', 4000 ),
			'assignee_id' => $assignee,
			'status'      => pd_one_of( $b['status'] ?? 'todo', PD_TASK_STATUSES, 'todo' ),
			'priority'    => pd_one_of( $b['priority'] ?? 'normal', PD_TASK_PRIORITIES, 'normal' ),
			'due_date'    => pd_date( $b['dueDate'] ?? '' ),
			'created_by'  => get_current_user_id(),
			'created_at'  => pd_now(),
		)
	);
	$task_id = (int) $wpdb->insert_id;
	pd_task_notify_assignee( $task_id, $assignee, 'A task was assigned to you' );
	return $task_id;
}

/** Updates a task's fields. Returns the mapped task or a WP_Error. */
function pd_update_task( int $task_id, array $b ) {
	global $wpdb;
	$task = pd_get_row( 'tasks', $task_id );
	if ( ! $task ) {
		return pd_error( 'Task not found.', 404 );
	}
	$fields = array();
	if ( isset( $b['title'] ) && pd_text( $b['title'], 200 ) ) {
		$fields['title'] = pd_text( $b['title'], 200 );
	}
	if ( array_key_exists( 'details', $b ) ) {
		$fields['details'] = pd_textarea( $b['details'], 4000 );
	}
	if ( array_key_exists( 'assigneeId', $b ) ) {
		$fields['assignee_id'] = pd_task_assignee( $b['assigneeId'] );
	}
	if ( isset( $b['priority'] ) ) {
		$fields['priority'] = pd_one_of( $b['priority'], PD_TASK_PRIORITIES, $task['priority'] );
	}
	if ( array_key_exists( 'dueDate', $b ) ) {
		$fields['due_date'] = pd_date( $b['dueDate'] );
	}
	if ( isset( $b['status'] ) ) {
		$status             = pd_one_of( $b['status'], PD_TASK_STATUSES, $task['status'] );
		$fields['status']   = $status;
		$fields['completed_at'] = 'done' === $status ? ( $task['completed_at'] ?: pd_now() ) : null;
	}
	if ( $fields ) {
		$wpdb->update( pd_table( 'tasks' ), $fields, array( 'id' => $task_id ) );
	}
	// Tell a newly assigned teammate (unless they assigned it to themselves).
	if ( array_key_exists( 'assignee_id', $fields ) && $fields['assignee_id'] && (int) $fields['assignee_id'] !== (int) $task['assignee_id'] ) {
		pd_task_notify_assignee( $task_id, (int) $fields['assignee_id'], 'A task was assigned to you' );
	}
	return pd_map_task( pd_get_row( 'tasks', $task_id ) );
}

/** Removes a task. */
function pd_delete_task( int $task_id ): bool {
	global $wpdb;
	if ( ! pd_get_row( 'tasks', $task_id ) ) {
		return false;
	}
	return (bool) $wpdb->delete( pd_table( 'tasks' ), array( 'id' => $task_id ) );
}

/** Emails a staff member that a task is theirs, unless they assigned it to themselves. */
function pd_task_notify_assignee( int $task_id, ?int $assignee_id, string $title ): void {
	if ( ! $assignee_id || $assignee_id === get_current_user_id() ) {
		return;
	}
	$task = pd_get_row( 'tasks', $task_id );
	$user = get_user_by( 'id', $assignee_id );
	if ( ! $task || ! $user ) {
		return;
	}
	$where = '';
	if ( $task['project_id'] ) {
		$project = pd_get_row( 'projects', (int) $task['project_id'] );
		$where   = $project ? ' on ' . $project['name'] : '';
	}
	pd_notify(
		array(
			array(
				'audience' => 'staff',
				'title'    => $title . ': ' . $task['title'],
				'body'     => trim( sprintf( '%s%s%s', $task['title'], $where, $task['due_date'] ? ' — due ' . $task['due_date'] : '' ) ),
				'channels' => array( 'email' ),
				'email'    => $user->user_email,
			),
		)
	);
}
