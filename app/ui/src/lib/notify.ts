import { notifications } from '@mantine/notifications';

type NotifyOptions = Parameters<typeof notifications.show>[0];

/** 统一通知出口：自动消失的提示不需要"关闭"按钮（Mantine 的 withCloseButton）。 */
export function notify(options: NotifyOptions): void {
  notifications.show({ withCloseButton: false, autoClose: 3200, ...options });
}
