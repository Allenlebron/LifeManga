// 角色姿势池。从 iOS 端 OpenAIService.extendedPoseGroups 1:1 移植。
//
// 5 大类共 30+ 个姿势, 用户可以多选, "动作合集"模式会把它们合并到一张图里出。

export interface CharacterPose {
  /** 中文标签, 显示给用户 */
  label: string
  /** 英文 prompt 描述这个动作 / 镜头, 给 OpenAI */
  prompt: string
}

export interface PoseGroup {
  id: string
  title: string
  poses: CharacterPose[]
}

export const POSE_GROUPS: readonly PoseGroup[] = [
  {
    id: 'daily',
    title: '日常动作',
    poses: [
      { label: '行走', prompt: 'walking forward at normal pace, casual stride, full body, slight 3/4 angle' },
      { label: '奔跑', prompt: 'running fast, dynamic action pose, motion lines, hair and clothes flowing back' },
      { label: '跳跃', prompt: 'mid-air jump with arms raised, dynamic upward motion, full body' },
      { label: '坐着', prompt: 'sitting on a chair (or floor), relaxed pose, full body visible' },
      { label: '躺下', prompt: 'lying on back peacefully, full body horizontal, hands at sides' },
      { label: '蹲下', prompt: 'squatting/crouching low to the ground, balanced pose, full body' },
      { label: '靠墙', prompt: 'leaning against a wall casually, one foot up, hands in pockets, full body' },
      { label: '走路看手机', prompt: 'walking while looking at smartphone, head slightly down, full body' },
    ],
  },
  {
    id: 'emotion',
    title: '情绪表现',
    poses: [
      { label: '大笑', prompt: 'laughing happily with head tilted back, big smile, joyful expression, full body' },
      { label: '哭泣', prompt: 'crying with tears, sad expression, slumped shoulders' },
      { label: '生气', prompt: 'angry expression, fists clenched, aggressive standing posture' },
      { label: '惊讶', prompt: 'shocked surprised expression, eyes wide, mouth open, recoiling slightly' },
      { label: '害羞', prompt: 'shy embarrassed look, blushing, averted gaze, hand near face' },
      { label: '思考', prompt: 'thinking pose, hand on chin, contemplative expression, full body' },
    ],
  },
  {
    id: 'action',
    title: '动作戏（非血腥）',
    poses: [
      { label: '防御', prompt: 'defensive stance, arms raised guarding face, balanced ready pose' },
      { label: '出拳', prompt: 'punching forward dynamically, fist extended, action pose with motion' },
      { label: '踢腿', prompt: 'high kick pose, leg extended, dynamic action' },
      { label: '摔倒', prompt: 'falling backward off-balance dramatically (no injury), full body' },
      { label: '全力冲刺', prompt: 'sprinting at full speed, leaning forward, dramatic forward motion' },
    ],
  },
  {
    id: 'interaction',
    title: '互动 / 表演',
    poses: [
      { label: '招手', prompt: 'waving hand in friendly greeting, big smile, full body' },
      { label: '敬礼', prompt: 'saluting formally, upright posture, full body' },
      { label: '握手', prompt: 'extending hand for a handshake, friendly expression' },
      { label: '指着前方', prompt: 'pointing forward dramatically, full body, determined expression' },
      { label: '鞠躬', prompt: 'bowing politely, hands at sides, traditional bow' },
    ],
  },
  {
    id: 'camera',
    title: '镜头视角',
    poses: [
      { label: '正面特写', prompt: 'head and shoulders close-up portrait, front view, neutral expression' },
      { label: '侧脸特写', prompt: 'side profile close-up, head and shoulders only' },
      { label: '3/4 视角', prompt: 'three-quarter angle full body view, slightly turned' },
      { label: '仰视镜头', prompt: 'low angle dramatic shot looking up at the character, full body, towering perspective' },
      { label: '俯视镜头', prompt: 'high angle shot looking down at the character, full body, top-down feel' },
      { label: '侧面', prompt: 'pure 90-degree side profile, full body, character facing left or right, clean readable silhouette' },
      { label: '背面', prompt: 'full back view, character facing AWAY from camera, full body visible from behind' },
      { label: '前半侧面', prompt: 'three-quarter FRONT angle, full body, character mostly facing camera with a slight turn so most of the face is visible' },
      { label: '后半侧面', prompt: 'three-quarter BACK angle, full body, character mostly facing away with shoulder/back visible, only a sliver of face from over the shoulder' },
    ],
  },
] as const

/** 全部 pose 平铺成一个 array, 方便 lookup */
export const ALL_POSES: readonly CharacterPose[] = POSE_GROUPS.flatMap((g) => g.poses)
