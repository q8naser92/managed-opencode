using System;
using WixToolset.Dtf.WindowsInstaller;
public static class ManagedCustomActions {
    [CustomAction]
    public static ActionResult BeginTransaction(Session session) {
        session["MANAGEDTXID"] = Guid.NewGuid().ToString("N");
        return ActionResult.Success;
    }
}
