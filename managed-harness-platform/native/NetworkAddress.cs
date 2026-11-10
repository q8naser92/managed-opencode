using System;

static class NetworkAddress {
    public static string Origin(string value){
        Uri uri;
        if(!Uri.TryCreate(value,UriKind.Absolute,out uri)||uri.Scheme!="https"||uri.UserInfo!=""||uri.AbsolutePath!="/"||uri.Query!=""||uri.Fragment!="")
            throw new ArgumentException("Enter an HTTPS server address without a path, query or embedded credentials.");
        return uri.GetLeftPart(UriPartial.Authority);
    }
}
