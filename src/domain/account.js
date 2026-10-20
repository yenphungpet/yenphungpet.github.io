// Tài khoản — đổi mật khẩu. Mật khẩu KHÔNG lưu ở app: kiểm tra & đổi hoàn toàn qua Supabase Auth.

export const PASSWORD_MIN = 8;

/** Kiểm tra biểu mẫu đổi mật khẩu trước khi gửi máy chủ. Trả về danh sách lỗi (rỗng = hợp lệ). */
export function validatePasswordChange({ current = '', next = '', confirm = '' } = {}) {
  const errs = [];
  if (!current) errs.push('Nhập mật khẩu hiện tại.');
  if (!next) errs.push('Nhập mật khẩu mới.');
  else if (next.length < PASSWORD_MIN) errs.push(`Mật khẩu mới cần ít nhất ${PASSWORD_MIN} ký tự.`);
  else if (/^\s|\s$/.test(next)) errs.push('Mật khẩu mới không được bắt đầu hoặc kết thúc bằng khoảng trắng.');
  if (next && !confirm) errs.push('Nhập lại mật khẩu mới để xác nhận.');
  else if (next && confirm !== next) errs.push('Hai lần nhập mật khẩu mới không khớp.');
  if (current && next && current === next) errs.push('Mật khẩu mới phải khác mật khẩu hiện tại.');
  return errs;
}

/** Lỗi từ Supabase Auth ⇒ thông báo tiếng Việt dễ hiểu. */
export function passwordErrorMessage(err) {
  const m = String(err?.code || '') + ' ' + String(err?.message || err || '');
  if (/wrong_current|invalid.?(login )?credentials|invalid_credentials/i.test(m)) return 'Mật khẩu hiện tại không đúng.';
  if (/same_password|different from the old/i.test(m)) return 'Mật khẩu mới phải khác mật khẩu hiện tại.';
  if (/weak_password|at least|too weak|password should/i.test(m)) return 'Mật khẩu mới chưa đủ mạnh theo quy định máy chủ — hãy dùng mật khẩu dài hơn, có cả chữ và số.';
  if (/rate.?limit|too many|429/i.test(m)) return 'Thử quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.';
  if (/reauthenticat/i.test(m)) return 'Máy chủ yêu cầu đăng nhập lại. Hãy đăng xuất, đăng nhập lại rồi đổi mật khẩu.';
  if (/failed to fetch|network|load failed/i.test(m)) return 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.';
  return `Không đổi được mật khẩu: ${String(err?.message || err)}`;
}
