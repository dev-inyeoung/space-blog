/*
 * ORBIT.LOG — 백엔드 설정
 * publishable key 만 둔다 (RLS 로 보호됨). service_role key 는 절대 넣지 말 것.
 * 이 파일을 지우거나 값을 비우면 localStorage 전용 모드로 동작한다.
 */
window.ORBIT_CONFIG = {
  supabaseUrl: 'https://eofftrzjhvdogucscngd.supabase.co',
  supabaseKey: 'sb_publishable_HfcKxhpLBwvtPjuMwrmb8A_LAQ5ozjx',
};
