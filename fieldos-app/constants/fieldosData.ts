/**
 * FieldOS Nepal — Local dummy data
 *
 * All screens reference this file for sample data.
 * Replace with real API data when connecting to backend.
 */

// ─── Staff ──────────────────────────────────────────────────────
export const STAFF = {
  name: 'Ram Bahadur Shah',
  nameNe: 'राम बहादुर शाह',
  role: 'Field Officer',
  roleNe: 'क्षेत्र अधिकारी',
  employeeId: 'FO-208',
  branch: 'Kathmandu West Branch',
  branchNe: 'काठमाडौं पश्चिम शाखा',
  institution: 'Asha Laghubitta',
  institutionNe: 'आशा लघुवित्त वित्तीय संस्था',
};

// ─── Clients ────────────────────────────────────────────────────
export const CLIENTS = [
  {
    id: 'M-1042',
    name: 'Sunita Kumari Chaudhary',
    nameNe: 'सुनिता कुमारी चौधरी',
    center: 'Janakpur Center',
    centerNe: 'जनकपुर केन्द्र',
    ward: 'Ward 7, Butwal',
    wardNe: 'वार्ड ७, बुटवल',
    loanCycle: 3,
    dueAmount: 5500,
    outstanding: 45000,
    lastPayment: 'NPR 2,500 · 28d ago',
    nextInstallment: 'Today',
    status: 'overdue' as const,
    statusLabel: '8 Days Overdue',
    reason: 'Promise-to-pay due today + overdue',
  },
  {
    id: 'M-1056',
    name: 'Rita Maya Tamang',
    nameNe: 'रिता माया तामाङ',
    center: 'Bhaktapur Women Ctr',
    centerNe: 'भक्तपुर महिला केन्द्र',
    ward: 'Ward 3, Bhaktapur',
    wardNe: 'वार्ड ३, भक्तपुर',
    loanCycle: 2,
    dueAmount: 3200,
    outstanding: 28000,
    lastPayment: 'NPR 3,200 · 7d ago',
    nextInstallment: 'Today',
    status: 'due-today' as const,
    statusLabel: 'Due Today',
    reason: 'Regular weekly installment',
  },
  {
    id: 'M-1089',
    name: 'Sita Devi Sah',
    nameNe: 'सीता देवी साह',
    center: 'Kalika Women Center',
    centerNe: 'कालिका महिला केन्द्र',
    ward: 'Ward 5, Kalanki',
    wardNe: 'वार्ड ५, कलन्की',
    loanCycle: 4,
    dueAmount: 15000,
    outstanding: 120000,
    lastPayment: 'NPR 5,000 · 45d ago',
    nextInstallment: 'Overdue',
    status: 'high-value' as const,
    statusLabel: 'High Value',
    reason: 'Due amount above NPR 10,000',
  },
  {
    id: 'M-1101',
    name: 'Ramesh Thapa',
    nameNe: 'रमेश थापा',
    center: 'Pokhara Trade Ctr',
    centerNe: 'पोखरा व्यापार केन्द्र',
    ward: 'Ward 12, Pokhara',
    wardNe: 'वार्ड १२, पोखरा',
    loanCycle: 2,
    dueAmount: 2800,
    outstanding: 18000,
    lastPayment: 'NPR 2,800 · 30d ago',
    nextInstallment: 'Overdue',
    status: 'overdue' as const,
    statusLabel: '15 Days Overdue',
    reason: 'Multiple missed payments',
  },
  {
    id: 'M-1115',
    name: 'Maya Devi Shrestha',
    nameNe: 'माया देवी श्रेष्ठ',
    center: 'Lalitpur Savi Ctr',
    centerNe: 'ललितपुर सावी केन्द्र',
    ward: 'Ward 2, Patan',
    wardNe: 'वार्ड २, पाटन',
    loanCycle: 5,
    dueAmount: 4100,
    outstanding: 35000,
    lastPayment: 'NPR 4,100 · 14d ago',
    nextInstallment: 'Today',
    status: 'promise' as const,
    statusLabel: 'Promise Due',
    reason: 'Previous promise expires today',
  },
  {
    id: 'M-1123',
    name: 'Gita Kumari Gupta',
    nameNe: 'गिता कुमारी गुप्ता',
    center: 'Chitwan Mahila Ctr',
    centerNe: 'चितवन महिला केन्द्र',
    ward: 'Ward 8, Bharatpur',
    wardNe: 'वार्ड ८, भरतपुर',
    loanCycle: 3,
    dueAmount: 6750,
    outstanding: 52000,
    lastPayment: 'NPR 6,750 · 3d ago',
    nextInstallment: 'In 4 days',
    status: 'sync' as const,
    statusLabel: 'Pending Sync',
    reason: 'Collection recorded, pending CBS sync',
  },
];

// ─── Center Meeting Members ─────────────────────────────────────
export const MEETING_MEMBERS = [
  { name: 'Sunita Kumari Chaudhary', id: 'M-1042', status: 'present' as const },
  { name: 'Rita Maya Tamang', id: 'M-1056', status: 'present' as const },
  { name: 'Gita Kumari Gupta', id: 'M-1123', status: 'paid' as const },
  { name: 'Sita Devi Sah', id: 'M-1089', status: 'absent' as const },
  { name: 'Maya Devi Shrestha', id: 'M-1115', status: 'present' as const },
  { name: 'Kamala Rai', id: 'M-1035', status: 'paid' as const },
  { name: 'Bishnu Maya Kami', id: 'M-1048', status: 'follow-up' as const },
  { name: 'Anita Maharjan', id: 'M-1067', status: 'present' as const },
  { name: 'Sarita Tharu', id: 'M-1079', status: 'follow-up' as const },
  { name: 'Nirmala Devi Pun', id: 'M-1091', status: 'paid' as const },
  { name: 'Laxmi Poudel', id: 'M-1098', status: 'absent' as const },
  { name: 'Padma Kumari BK', id: 'M-1105', status: 'present' as const },
  { name: 'Hari Maya Damai', id: 'M-1112', status: 'follow-up' as const },
  { name: 'Sushila Tamang', id: 'M-1119', status: 'present' as const },
];

// ─── Payment Methods ────────────────────────────────────────────
export const PAYMENT_METHODS = [
  { key: 'cash', label: 'Cash', labelNe: 'नगद', emoji: '💵' },
  { key: 'qr', label: 'QR', labelNe: 'क्यूआर', emoji: '📱' },
  { key: 'mobile-banking', label: 'Mobile Banking', labelNe: 'मोबाइल बैंकिङ', emoji: '🏦' },
  { key: 'esewa', label: 'eSewa', labelNe: 'ईसेवा', emoji: '🟢' },
  { key: 'khalti', label: 'Khalti', labelNe: 'खल्ती', emoji: '🟣' },
  { key: 'ime-pay', label: 'IME Pay', labelNe: 'आइएमई पे', emoji: '🔵' },
  { key: 'bank-transfer', label: 'Bank Transfer', labelNe: 'बैंक ट्रान्सफर', emoji: '🏛️' },
  { key: 'connectips', label: 'connectIPS', labelNe: 'कनेक्टआईपीएस', emoji: '🔗' },
  { key: 'other', label: 'Other', labelNe: 'अन्य', emoji: '📝' },
];

// ─── Visit Purposes ─────────────────────────────────────────────
export const VISIT_PURPOSES = [
  { key: 'collection', label: 'Collection', labelNe: 'संकलन', emoji: '💰' },
  { key: 'follow-up', label: 'Follow-up', labelNe: 'फलो-अप', emoji: '🔄' },
  { key: 'kyc', label: 'KYC/Document', labelNe: 'केवाईसी/कागजात', emoji: '📋' },
  { key: 'meeting', label: 'Center Meeting', labelNe: 'केन्द्र बैठक', emoji: '👥' },
  { key: 'complaint', label: 'Complaint', labelNe: 'गुनासो', emoji: '💬' },
  { key: 'other', label: 'Other', labelNe: 'अन्य', emoji: '📝' },
];

// ─── Promise-to-Pay Options ─────────────────────────────────────
export const PROMISE_DATES = [
  { key: 'today', label: 'Today', labelNe: 'आज' },
  { key: 'tomorrow', label: 'Tomorrow', labelNe: 'भोलि' },
  { key: '3days', label: '3 Days', labelNe: '३ दिन' },
  { key: 'next-meeting', label: 'Next Meeting', labelNe: 'अर्को बैठक' },
];

export const PROMISE_REASONS = [
  { key: 'no-cash', label: 'No cash today', labelNe: 'आज कुनै नगद छैन' },
  { key: 'unavailable', label: 'Client unavailable', labelNe: 'क्लाइन्ट उपलब्ध छैन' },
  { key: 'business', label: 'Business issue', labelNe: 'व्यापार समस्या' },
  { key: 'health', label: 'Family/health issue', labelNe: 'परिवार/स्वास्थ्य समस्या' },
  { key: 'dispute', label: 'Dispute', labelNe: 'विवाद' },
  { key: 'migration', label: 'Migration', labelNe: 'प्रवास' },
  { key: 'other', label: 'Other', labelNe: 'अन्य' },
];

// ─── Notifications ──────────────────────────────────────────────
export const NOTIFICATIONS = [
  {
    id: 1,
    icon: 'time-outline' as const,
    iconColor: '#DC2626',
    title: 'Promise-to-pay due today',
    titleNe: 'आज प्रतिबद्धता थप',
    description: 'Sunita Kumari Chaudhary — NPR 5,500',
    descriptionNe: 'सुनिता कुमारी चौधरी — NPR 5,500',
    time: '2h ago',
    actionLabel: 'Start Visit',
    actionLabelNe: 'भेट थाल्नुहोस्',
    screen: 'client-detail' as const,
    filter: 'tasks',
  },
  {
    id: 2,
    icon: 'cloud-outline' as const,
    iconColor: '#F59E0B',
    title: '5 records pending sync',
    titleNe: '५ रेकर्ड पेन्डिङ सिंक',
    description: 'Sync when connected',
    descriptionNe: 'जडान भएपछि सिंक गर्नुहोस्',
    time: '30m ago',
    actionLabel: 'Sync Now',
    actionLabelNe: 'अहिले सिंक',
    screen: 'sync-center' as const,
    filter: 'alerts',
  },
  {
    id: 3,
    icon: 'person-outline' as const,
    iconColor: '#0B1B3A',
    title: 'Manager assigned task',
    titleNe: 'प्रबन्धकले कार्य दिए',
    description: 'Visit Ramesh Thapa for KYC',
    descriptionNe: 'रमेश थापालाई भेट गर्नुहोस्',
    time: '1h ago',
    actionLabel: 'View Task',
    actionLabelNe: 'कार्य हेर्नुहोस्',
    screen: 'due-collections' as const,
    filter: 'tasks',
  },
  {
    id: 4,
    icon: 'settings-outline' as const,
    iconColor: '#6B7280',
    title: 'App update available',
    titleNe: 'एप अपडेट',
    description: 'FieldOS Nepal v2.2.0',
    descriptionNe: 'v2.2.0 — सुरक्षा सुधार',
    time: '3h ago',
    filter: 'system',
  },
  {
    id: 5,
    icon: 'alert-triangle-outline' as const,
    iconColor: '#DC2626',
    title: 'Overdue alert',
    titleNe: 'अतिरिक्त चेतावनी',
    description: 'Sita Devi Sah is 15 days overdue',
    descriptionNe: 'सीता देवी साह १५ दिन अतिरिक्त',
    time: '5h ago',
    actionLabel: 'View Client',
    actionLabelNe: 'क्लाइन्ट हेर्नुहोस्',
    screen: 'client-detail' as const,
    filter: 'alerts',
  },
  {
    id: 6,
    icon: 'document-text-outline' as const,
    iconColor: '#0B1B3A',
    title: 'Center meeting reminder',
    titleNe: 'बैठक स्मरण',
    description: 'Kalika Women Center — Tomorrow 10AM',
    descriptionNe: 'कालिका महिला — भोलि १०:००',
    time: '6h ago',
    actionLabel: 'View',
    actionLabelNe: 'हेर्नुहोस्',
    screen: 'center-meeting' as const,
    filter: 'tasks',
  },
  {
    id: 7,
    icon: 'shield-checkmark' as const,
    iconColor: '#16A34A',
    title: 'Security audit completed',
    titleNe: 'सुरक्षा अडिट पूरा',
    description: 'No issues found',
    descriptionNe: 'कुनै मुद्दा भेटिएन',
    time: '1d ago',
    filter: 'system',
  },
];

// ─── Sync Items ─────────────────────────────────────────────────
export const SYNC_ITEMS = [
  { label: 'Collection records', labelNe: 'संकलन रेकर्ड', count: 5, icon: 'document-text-outline' as const },
  { label: 'Visit check-ins', labelNe: 'भेट चेक-इन', count: 3, icon: 'location-outline' as const },
  { label: 'Promise-to-pay', labelNe: 'प्रतिबद्धता', count: 2, icon: 'handshake-outline' as const },
  { label: 'Center meetings', labelNe: 'केन्द्र बैठक', count: 1, icon: 'people-outline' as const },
  { label: 'EOD reports', labelNe: 'EOD प्रतिवेदन', count: 1, icon: 'document-text-outline' as const },
];

// ─── End-of-Day Exceptions ──────────────────────────────────────
export const EOD_EXCEPTIONS = [
  { label: 'Missing receipt', labelNe: 'रसिद हराइयो', count: 1, icon: 'document-text-outline' as const, color: '#F59E0B' },
  { label: 'Partial payment', labelNe: 'आंशिक भुक्तानी', count: 2, icon: 'wallet-outline' as const, color: '#D97706' },
  { label: 'Client unavailable', labelNe: 'क्लाइन्ट उपलब्ध छैन', count: 1, icon: 'people-outline' as const, color: '#6B7280' },
  { label: 'Pending sync', labelNe: 'पेन्डिङ सिंक', count: 5, icon: 'cloud-outline' as const, color: '#0B1B3A' },
  { label: 'High-value pending', labelNe: 'उच्च-मूल्य पेन्डिङ', count: 1, icon: 'shield-outline' as const, color: '#7C3AED' },
];

// ─── Task Filters ───────────────────────────────────────────────
export const TASK_FILTERS = [
  { key: 'all', label: 'All Due' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Due Today' },
  { key: 'promise', label: 'Promise Due' },
  { key: 'high-value', label: 'High Value' },
  { key: 'sync', label: 'Pending Sync' },
];

// ─── Notification Filters ───────────────────────────────────────
export const NOTIFICATION_FILTERS = [
  { key: 'all', label: 'All', labelNe: 'सबै' },
  { key: 'tasks', label: 'Tasks', labelNe: 'कार्य' },
  { key: 'alerts', label: 'Alerts', labelNe: 'चेतावनी' },
  { key: 'system', label: 'System', labelNe: 'प्रणाली' },
];

// ─── Security Settings ──────────────────────────────────────────
export const SECURITY_ITEMS = [
  {
    icon: 'lock-closed' as const,
    labelEn: 'App Lock',
    labelNe: 'एप लक',
    descEn: 'PIN / Biometric',
    descNe: 'PIN / बायोमेट्रिक',
    status: 'Active',
    statusNe: 'सक्रिय',
    variant: 'verified' as const,
  },
  {
    icon: 'shield-checkmark' as const,
    labelEn: 'Identity Verification',
    labelNe: 'परिचय प्रमाणीकरण',
    descEn: 'Face verification',
    descNe: 'अनुहार प्रमाणीकरण',
    status: 'Active',
    statusNe: 'सक्रिय',
    variant: 'verified' as const,
  },
  {
    icon: 'shield' as const,
    labelEn: 'Local Data Encryption',
    labelNe: 'स्थानीय डाटा एन्क्रिप्शन',
    descEn: 'AES-256 encryption',
    descNe: 'AES-256 एन्क्रिप्शन',
    status: 'Active',
    statusNe: 'सक्रिय',
    variant: 'verified' as const,
  },
  {
    icon: 'time' as const,
    labelEn: 'Audit Logs',
    labelNe: 'अडिट लगहरू',
    descEn: 'Last 30 days',
    descNe: 'अन्तिम ३० दिन',
    status: '12 entries',
    statusNe: '१२ प्रविष्टिहरू',
    variant: 'info' as const,
  },
];

// ─── App Version ────────────────────────────────────────────────
export const APP_VERSION = '2.1.0';
