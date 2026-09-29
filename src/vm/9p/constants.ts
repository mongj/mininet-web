// Must match `msize=` in the guest/init 9p mount options.
export const P9_MSIZE = 8192;
export const P9_MIN_MSIZE = 4096;
export const P9_VERSION = '9P2000.L';
export const NAME_MAX = 255;

/** size[4] type[1] tag[2] */
export const P9_HEADER_SIZE = 7;
/** type[1] version[4] path[8] */
export const P9_QID_SIZE = 13;
/** qid[13] offset[8] type[1] name_len[2], followed by the name bytes. */
export const P9_DIRENT_FIXED_SIZE = P9_QID_SIZE + 8 + 1 + 2;
/** Rread / Rreaddir: header + count[4]. */
export const P9_RREAD_OVERHEAD = P9_HEADER_SIZE + 4;
/** Twrite: header + fid[4] offset[8] count[4]. */
export const P9_TWRITE_OVERHEAD = P9_HEADER_SIZE + 4 + 8 + 4;
// iounit bounds both Tread replies and Twrite requests; Twrite has the larger overhead.
export const P9_IOUNIT = P9_MSIZE - P9_TWRITE_OVERHEAD;

export const P9_RLERROR = 7;
export const P9_TSTATFS = 8;
export const P9_RSTATFS = 9;
export const P9_TLOPEN = 12;
export const P9_RLOPEN = 13;
export const P9_TLCREATE = 14;
export const P9_RLCREATE = 15;
export const P9_TSYMLINK = 16;
export const P9_RSYMLINK = 17;
export const P9_TMKNOD = 18;
export const P9_TRENAME = 20;
export const P9_RRENAME = 21;
export const P9_TREADLINK = 22;
export const P9_RREADLINK = 23;
export const P9_TGETATTR = 24;
export const P9_RGETATTR = 25;
export const P9_TSETATTR = 26;
export const P9_RSETATTR = 27;
export const P9_TXATTRWALK = 30;
export const P9_TXATTRCREATE = 32;
export const P9_TREADDIR = 40;
export const P9_RREADDIR = 41;
export const P9_TFSYNC = 50;
export const P9_RFSYNC = 51;
export const P9_TLOCK = 52;
export const P9_RLOCK = 53;
export const P9_TGETLOCK = 54;
export const P9_RGETLOCK = 55;
export const P9_TLINK = 70;
export const P9_TMKDIR = 72;
export const P9_RMKDIR = 73;
export const P9_TRENAMEAT = 74;
export const P9_RRENAMEAT = 75;
export const P9_TUNLINKAT = 76;
export const P9_RUNLINKAT = 77;
export const P9_TVERSION = 100;
export const P9_RVERSION = 101;
export const P9_TAUTH = 102;
export const P9_TATTACH = 104;
export const P9_RATTACH = 105;
export const P9_TFLUSH = 108;
export const P9_RFLUSH = 109;
export const P9_TWALK = 110;
export const P9_RWALK = 111;
export const P9_TREAD = 116;
export const P9_RREAD = 117;
export const P9_TWRITE = 118;
export const P9_RWRITE = 119;
export const P9_TCLUNK = 120;
export const P9_RCLUNK = 121;
export const P9_TREMOVE = 122;
export const P9_RREMOVE = 123;

export const EPERM = 1;
export const ENOENT = 2;
export const EIO = 5;
export const EBADF = 9;
export const EACCES = 13;
export const EBUSY = 16;
export const EEXIST = 17;
export const ENOTDIR = 20;
export const EISDIR = 21;
export const EINVAL = 22;
export const ENOSPC = 28;
export const ENAMETOOLONG = 36;
export const ENOTEMPTY = 39;
export const ELOOP = 40;
export const EOPNOTSUPP = 95;

export const P9_QTDIR = 0x80;
export const P9_QTSYMLINK = 0x02;
export const P9_QTFILE = 0x00;

export const S_IFMT = 0xf000;
export const S_IFLNK = 0xa000;
export const S_IFREG = 0x8000;
export const S_IFDIR = 0x4000;
export const S_IRWXUGO = 0o7777;

export const DT_DIR = 4;
export const DT_REG = 8;
export const DT_LNK = 10;

export const O_ACCMODE = 0x3;
export const O_RDONLY = 0x0;
export const O_TRUNC = 0x200;
export const O_DIRECTORY = 0x10000;
export const O_NOFOLLOW = 0x20000;

export const AT_REMOVEDIR = 0x200;

export const P9_SETATTR_MODE = 0x00000001;
export const P9_SETATTR_UID = 0x00000002;
export const P9_SETATTR_GID = 0x00000004;
export const P9_SETATTR_SIZE = 0x00000008;
export const P9_SETATTR_ATIME = 0x00000010;
export const P9_SETATTR_MTIME = 0x00000020;
export const P9_SETATTR_CTIME = 0x00000040;
export const P9_SETATTR_ATIME_SET = 0x00000080;
export const P9_SETATTR_MTIME_SET = 0x00000100;

export const P9_STATS_BASIC = 0x000007ffn;

export const P9_LOCK_TYPE_UNLCK = 2;
export const P9_LOCK_SUCCESS = 0;
